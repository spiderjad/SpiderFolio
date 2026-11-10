// Spare parts and stock from the warehouse system (docs/spec/mantenimiento.md, section 6). The SGA owns
// the stock: through the integration API it sends its catalogue (code, description, unit, stock, minimum,
// location) and reads what the work orders used, to discount it. Maintenance keeps a read-only copy to
// search it when adding a part, to show its stock, and for the AI to name codes. The SGA talks with an
// integration token the owner creates (shown once, only its SHA-256 kept, revocable).
import { createHash, randomBytes } from "node:crypto";
import type { TenantDb } from "../../db/tenant.ts";
import { forTenant } from "../../db/tenant.ts";
import { Prisma } from "../../generated/prisma/client.ts";
import { maintenanceTexts } from "../../i18n/index.ts";
import { AppError, notFound } from "../../lib/errors.ts";
import { nameKeyOf } from "../../lib/names.ts";
import type { PrismaClient } from "../../lib/prisma.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import {
  canViewMaintenance,
  canWorkMaintenance,
  requireMaintenance,
} from "./maintenance-access.ts";
import { maintenanceEnabled } from "./quality-link.ts";

export const TOKEN_SCOPES = ["parts.write", "consumption.read"] as const;
export type TokenScope = (typeof TOKEN_SCOPES)[number];
const TOKEN_PREFIX = "sfm_";

// ─── The catalogue, in the app ──────────────────────────────────────────────

export interface PartView {
  id: string;
  code: string;
  description: string;
  unit: string;
  stock: number | null;
  minStock: number | null;
  location: string;
  /** Stock at or under its minimum (as the SGA last said). */
  low: boolean;
  syncedAt: Date;
}

const partSelect = {
  id: true,
  code: true,
  description: true,
  unit: true,
  stock: true,
  minStock: true,
  location: true,
  syncedAt: true,
} as const;

function partView(row: Prisma.MaintPartGetPayload<{ select: typeof partSelect }>): PartView {
  const stock = row.stock === null ? null : row.stock.toNumber();
  const minStock = row.minStock === null ? null : row.minStock.toNumber();
  return {
    id: row.id,
    code: row.code,
    description: row.description,
    unit: row.unit,
    stock,
    minStock,
    location: row.location,
    low: stock !== null && minStock !== null && stock <= minStock,
    syncedAt: row.syncedAt,
  };
}

/** Search the catalogue by code or description (whoever works in or sees maintenance). */
export async function searchParts(
  ctx: AdminContext,
  query: { q: string },
): Promise<{ parts: PartView[]; total: number }> {
  await requireMaintenance(ctx);
  if (!canWorkMaintenance(ctx) && !canViewMaintenance(ctx)) return { parts: [], total: 0 };
  const q = query.q.trim();
  const where: Prisma.MaintPartWhereInput = {
    active: true,
    ...(q === ""
      ? {}
      : {
          OR: [
            { codeKey: { startsWith: nameKeyOf(q) } },
            { code: { contains: q, mode: "insensitive" } },
            { description: { contains: q, mode: "insensitive" } },
          ],
        }),
  };
  const [rows, total] = await Promise.all([
    ctx.db.maintPart.findMany({ where, orderBy: { code: "asc" }, take: 20, select: partSelect }),
    ctx.db.maintPart.count({ where: { active: true } }),
  ]);
  return { parts: rows.map(partView), total };
}

/** Parts whose description shares words with a text (for the AI to name their codes). */
export async function partsForText(db: TenantDb, text: string): Promise<PartView[]> {
  const words = [
    ...new Set(
      text
        .toLowerCase()
        .normalize("NFD")
        .replace(/\p{M}/gu, "")
        .split(/[^\p{L}\p{N}-]+/u)
        .filter((word) => word.length >= 4),
    ),
  ].slice(0, 20);
  if (words.length === 0) return [];
  const rows = await db.maintPart.findMany({
    where: {
      active: true,
      OR: words.flatMap((word) => [
        { description: { contains: word, mode: "insensitive" as const } },
        { code: { contains: word, mode: "insensitive" as const } },
      ]),
    },
    take: 40,
    select: partSelect,
  });
  return rows.map(partView);
}

/** The catalogue part for a code, if the SGA sent it. */
export async function partByCode(db: TenantDb, code: string): Promise<PartView | null> {
  if (code.trim() === "") return null;
  const row = await db.maintPart.findFirst({
    where: { codeKey: nameKeyOf(code), active: true },
    select: partSelect,
  });
  return row === null ? null : partView(row);
}

// ─── Integration tokens (owner) ─────────────────────────────────────────────

export interface TokenView {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

const tokenSelect = {
  id: true,
  name: true,
  prefix: true,
  scopes: true,
  createdAt: true,
  lastUsedAt: true,
  revokedAt: true,
} as const;

const hashOf = (token: string) => createHash("sha256").update(token).digest("hex");

export async function listTokens(ctx: AdminContext): Promise<TokenView[]> {
  return await ctx.db.maintIntegrationToken.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    select: tokenSelect,
  });
}

/** A new token: the whole value is returned only now. */
export async function createToken(
  ctx: AdminContext,
  input: { name: string; scopes: TokenScope[] },
): Promise<{ token: string; view: TokenView }> {
  if (!(await maintenanceEnabled(ctx.db))) throw notFound();
  const token = `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  const view = await ctx.db.maintIntegrationToken.create({
    data: {
      name: input.name,
      tokenHash: hashOf(token),
      prefix: token.slice(0, TOKEN_PREFIX.length + 6),
      scopes: [...new Set(input.scopes)],
      createdById: ctx.tenant.membershipId,
    },
    select: tokenSelect,
  });
  await auditAdmin(ctx, {
    action: "maintenance.token.create",
    entityType: "MaintIntegrationToken",
    entityId: view.id,
    metadata: { name: view.name, scopes: view.scopes },
  });
  return { token, view };
}

export async function revokeToken(ctx: AdminContext, id: string): Promise<TokenView> {
  const row = await ctx.db.maintIntegrationToken.findFirst({
    where: { id },
    select: { id: true, revokedAt: true },
  });
  if (row === null) throw notFound();
  const view = await ctx.db.maintIntegrationToken.update({
    where: { id },
    data: { revokedAt: row.revokedAt ?? new Date() },
    select: tokenSelect,
  });
  await auditAdmin(ctx, {
    action: "maintenance.token.revoke",
    entityType: "MaintIntegrationToken",
    entityId: id,
    metadata: { name: view.name },
  });
  return view;
}

// ─── The integration API (the SGA) ──────────────────────────────────────────

export interface Integration {
  db: TenantDb;
  workspaceId: string;
  tokenId: string;
  scopes: string[];
}

/**
 * The company a token belongs to, if it's valid: not revoked and with Maintenance on. Null otherwise
 * (the router answers the same 401 whatever the reason).
 */
export async function authenticate(
  prisma: PrismaClient,
  header: string | undefined,
): Promise<Integration | null> {
  const match = /^Bearer\s+(\S+)$/u.exec(header ?? "");
  const token = match?.[1];
  if (token === undefined || !token.startsWith(TOKEN_PREFIX) || token.length > 200) return null;
  const row = await prisma.maintIntegrationToken.findUnique({
    where: { tokenHash: hashOf(token) },
    select: { id: true, workspaceId: true, scopes: true, revokedAt: true, lastUsedAt: true },
  });
  if (row === null || row.revokedAt !== null) return null;
  const db = forTenant(prisma, row.workspaceId);
  if (!(await maintenanceEnabled(db))) return null;
  // At most once a minute: it's informative, not a log.
  const now = new Date();
  if (row.lastUsedAt === null || now.getTime() - row.lastUsedAt.getTime() > 60_000) {
    await db.maintIntegrationToken.update({
      where: { id: row.id },
      data: { lastUsedAt: now },
      select: { id: true },
    });
  }
  return { db, workspaceId: row.workspaceId, tokenId: row.id, scopes: row.scopes };
}

export function requireScope(integration: Integration, scope: TokenScope): void {
  if (!integration.scopes.includes(scope)) {
    throw new AppError("FORBIDDEN", { message: maintenanceTexts.errors.tokenScope });
  }
}

const info = (integration: Integration) => ({
  db: integration.db,
  info: { actorId: "", ip: null, userAgent: null },
  tokenId: integration.tokenId,
});

export interface IncomingPart {
  code: string;
  description: string;
  unit: string;
  stock: number | null;
  minStock: number | null;
  location: string;
}

/**
 * The SGA's catalogue: each part created or updated by its code. `replace` (the whole catalogue in one
 * call) also retires the ones it didn't send; `retire` retires these codes.
 */
export async function syncParts(
  integration: Integration,
  input: { mode: "merge" | "replace"; parts: IncomingPart[]; retire: string[] },
): Promise<{ created: number; updated: number; retired: number }> {
  requireScope(integration, "parts.write");
  const { db } = integration;
  const now = new Date();
  const byKey = new Map<string, IncomingPart>();
  for (const part of input.parts) byKey.set(nameKeyOf(part.code), part);
  const keys = [...byKey.keys()];
  const existing = await db.maintPart.findMany({
    where: { codeKey: { in: keys } },
    select: { id: true, codeKey: true },
  });
  const idOf = new Map(existing.map((row) => [row.codeKey, row.id]));
  let created = 0;
  let updated = 0;
  for (const [codeKey, part] of byKey) {
    const data = {
      code: part.code,
      description: part.description,
      unit: part.unit,
      stock: part.stock === null ? null : new Prisma.Decimal(part.stock),
      minStock: part.minStock === null ? null : new Prisma.Decimal(part.minStock),
      location: part.location,
      active: true,
      syncedAt: now,
    };
    const id = idOf.get(codeKey);
    if (id === undefined) {
      await db.maintPart.create({ data: { ...data, codeKey }, select: { id: true } });
      created += 1;
    } else {
      await db.maintPart.update({ where: { id }, data, select: { id: true } });
      updated += 1;
    }
  }
  const retireKeys = input.retire.map((code) => nameKeyOf(code));
  const toRetire: Prisma.MaintPartWhereInput[] = [
    ...(retireKeys.length === 0 ? [] : [{ codeKey: { in: retireKeys } }]),
    ...(input.mode === "replace" ? [{ codeKey: { notIn: keys } }] : []),
  ];
  // Nothing to retire: no query (an empty OR doesn't mean «none» to Prisma).
  const retired =
    toRetire.length === 0
      ? 0
      : (
          await db.maintPart.updateMany({
            where: { active: true, OR: toRetire },
            data: { active: false, syncedAt: now },
          })
        ).count;
  const counts = { created, updated, retired };
  const ctx = info(integration);
  await auditAdmin(ctx, {
    action: "maintenance.integration.parts",
    entityType: "MaintIntegrationToken",
    entityId: integration.tokenId,
    metadata: { mode: input.mode, ...counts },
  });
  return counts;
}

export interface ConsumptionItem {
  id: string;
  workOrder: string;
  workOrderStatus: string;
  asset: string | null;
  partCode: string;
  description: string;
  quantity: number;
  unit: string;
  usedAt: Date;
}

/**
 * What the work orders used since a moment, oldest first, by pages (`cursor`: the last id seen). The SGA
 * discounts it; a part removed from a work order no longer shows.
 */
export async function consumption(
  integration: Integration,
  query: { since: Date; cursor?: string | undefined; limit: number },
): Promise<{ items: ConsumptionItem[]; nextCursor: string | null }> {
  requireScope(integration, "consumption.read");
  const { db } = integration;
  const after =
    query.cursor === undefined
      ? null
      : await db.maintPartUse.findFirst({
          where: { id: query.cursor },
          select: { id: true, createdAt: true },
        });
  const rows = await db.maintPartUse.findMany({
    where: {
      createdAt: { gte: query.since },
      ...(after === null
        ? {}
        : {
            OR: [
              { createdAt: { gt: after.createdAt } },
              { createdAt: after.createdAt, id: { gt: after.id } },
            ],
          }),
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: query.limit + 1,
    select: {
      id: true,
      workOrderId: true,
      partCode: true,
      description: true,
      quantity: true,
      unit: true,
      createdAt: true,
    },
  });
  const page = rows.slice(0, query.limit);
  const orders = await db.maintWorkOrder.findMany({
    where: { id: { in: [...new Set(page.map((row) => row.workOrderId))] } },
    select: { id: true, year: true, number: true, status: true, assetId: true },
  });
  const assets = await db.maintAsset.findMany({
    where: {
      id: { in: orders.flatMap((order) => (order.assetId === null ? [] : [order.assetId])) },
    },
    select: { id: true, code: true },
  });
  const orderOf = new Map(orders.map((order) => [order.id, order]));
  const assetOf = new Map(assets.map((asset) => [asset.id, asset.code]));
  return {
    items: page.map((row) => {
      const order = orderOf.get(row.workOrderId);
      return {
        id: row.id,
        workOrder: order === undefined ? "" : maintenanceTexts.code(order.year, order.number),
        workOrderStatus: order?.status ?? "",
        asset: order?.assetId == null ? null : (assetOf.get(order.assetId) ?? null),
        partCode: row.partCode,
        description: row.description,
        quantity: row.quantity.toNumber(),
        unit: row.unit,
        usedAt: row.createdAt,
      };
    }),
    nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
  };
}
