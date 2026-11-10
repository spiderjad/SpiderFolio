// Equipment (docs/spec/mantenimiento.md, section 1): lines, machines and components in a tree, each with
// its documents folder in the module's space and a QR that opens «Report a breakdown» with it chosen.
import { maintenanceLimits } from "@spiderfolio/limits";
import type { TenantDb } from "../../db/tenant.ts";
import type { MaintAssetStatus, MaintCriticality, Prisma } from "../../generated/prisma/client.ts";
import { AppError, notFound } from "../../lib/errors.ts";
import { nameKeyOf } from "../../lib/names.ts";
import { maintenanceTexts } from "../../i18n/index.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { dayOf } from "../expiries/expiries.service.ts";
import { renderPng, renderSvg } from "../qr/qr-render.ts";
import { ensureFolder, liveFolder } from "../quality/quality-folders.ts";
import { dateOf, requireAny, requireManage } from "./maintenance-access.ts";
import { moduleSpace } from "./maintenance.service.ts";

export interface AssetView {
  id: string;
  code: string;
  name: string;
  parentId: string | null;
  location: string;
  manufacturer: string;
  model: string;
  serial: string;
  installedOn: string | null;
  criticality: MaintCriticality;
  foodContact: boolean;
  status: MaintAssetStatus;
  notes: string;
  folder: { spaceId: string; id: string } | null;
  /** Work orders not closed yet. */
  openWorkOrders: number;
  archived: boolean;
}

export interface AssetInput {
  code: string;
  name: string;
  parentId: string | null;
  location: string;
  manufacturer: string;
  model: string;
  serial: string;
  installedOn: string | null;
  criticality: MaintCriticality;
  foodContact: boolean;
  status: MaintAssetStatus;
  notes: string;
}

const select = {
  id: true,
  code: true,
  name: true,
  parentId: true,
  location: true,
  manufacturer: true,
  model: true,
  serial: true,
  installedOn: true,
  criticality: true,
  foodContact: true,
  status: true,
  notes: true,
  folderId: true,
  archivedAt: true,
} as const;

type Row = Prisma.MaintAssetGetPayload<{ select: typeof select }>;

async function views(ctx: AdminContext, rows: Row[]): Promise<AssetView[]> {
  const open = await ctx.db.maintWorkOrder.findMany({
    where: {
      assetId: { in: rows.map((row) => row.id) },
      status: { notIn: ["CLOSED", "CANCELLED"] },
    },
    select: { assetId: true },
  });
  const count = new Map<string, number>();
  for (const row of open) {
    if (row.assetId !== null) count.set(row.assetId, (count.get(row.assetId) ?? 0) + 1);
  }
  return await Promise.all(
    rows.map(async (row) => {
      const folder = await liveFolder(ctx, row.folderId);
      return {
        id: row.id,
        code: row.code,
        name: row.name,
        parentId: row.parentId,
        location: row.location,
        manufacturer: row.manufacturer,
        model: row.model,
        serial: row.serial,
        installedOn: row.installedOn === null ? null : dayOf(row.installedOn),
        criticality: row.criticality,
        foodContact: row.foodContact,
        status: row.status,
        notes: row.notes,
        folder: folder === null ? null : { spaceId: folder.spaceId, id: folder.id },
        openWorkOrders: count.get(row.id) ?? 0,
        archived: row.archivedAt !== null,
      };
    }),
  );
}

/** The whole tree (a plant has a few hundred pieces of equipment at most), ordered by code. */
export async function listAssets(
  ctx: AdminContext,
  query: { archived: boolean },
): Promise<AssetView[]> {
  await requireAny(ctx);
  const rows = await ctx.db.maintAsset.findMany({
    where: { archivedAt: query.archived ? { not: null } : null },
    select,
    orderBy: [{ code: "asc" }, { id: "asc" }],
    take: 2000,
  });
  return await views(ctx, rows);
}

export async function getAsset(ctx: AdminContext, id: string): Promise<AssetView> {
  await requireAny(ctx);
  const row = await ctx.db.maintAsset.findFirst({ where: { id }, select });
  if (row === null) throw notFound();
  return (await views(ctx, [row]))[0] as AssetView;
}

/** The parent must exist, not be the asset itself nor one of its own, and the tree not too deep. */
async function assertParent(db: TenantDb, id: string | null, parentId: string | null) {
  if (parentId === null) return;
  let current: string | null = parentId;
  let depth = 1;
  while (current !== null) {
    if (current === id) {
      throw new AppError("BAD_REQUEST", { message: maintenanceTexts.errors.parentLoop });
    }
    const row: { parentId: string | null } | null = await db.maintAsset.findFirst({
      where: { id: current },
      select: { parentId: true },
    });
    if (row === null) throw notFound();
    current = row.parentId;
    depth += 1;
    if (depth > maintenanceLimits.assetDepthMax) {
      throw new AppError("BAD_REQUEST", { message: maintenanceTexts.errors.tooDeep });
    }
  }
}

async function assertFreeCode(db: TenantDb, code: string, except?: string) {
  const other = await db.maintAsset.findFirst({
    where: { codeKey: nameKeyOf(code), ...(except === undefined ? {} : { id: { not: except } }) },
    select: { id: true },
  });
  if (other !== null) {
    throw new AppError("CONFLICT", { message: maintenanceTexts.errors.codeExists });
  }
}

async function assetFolder(ctx: AdminContext, code: string, name: string): Promise<string> {
  const spaceId = await moduleSpace(ctx);
  const parent = await ensureFolder(ctx, spaceId, null, maintenanceTexts.folders.assets);
  return await ensureFolder(ctx, spaceId, parent, `${code} · ${name}`);
}

const data = (input: AssetInput) => ({
  code: input.code,
  codeKey: nameKeyOf(input.code),
  name: input.name,
  parentId: input.parentId,
  location: input.location,
  manufacturer: input.manufacturer,
  model: input.model,
  serial: input.serial,
  installedOn: input.installedOn === null ? null : dateOf(input.installedOn),
  criticality: input.criticality,
  foodContact: input.foodContact,
  status: input.status,
  notes: input.notes,
});

export async function createAsset(ctx: AdminContext, input: AssetInput): Promise<AssetView> {
  await requireManage(ctx);
  await assertFreeCode(ctx.db, input.code);
  await assertParent(ctx.db, null, input.parentId);
  const row = await ctx.db.maintAsset.create({
    data: { ...data(input), folderId: await assetFolder(ctx, input.code, input.name) },
    select,
  });
  await auditAdmin(ctx, {
    action: "maintenance.asset.create",
    entityType: "MaintAsset",
    entityId: row.id,
    metadata: { code: row.code, name: row.name },
  });
  return (await views(ctx, [row]))[0] as AssetView;
}

export async function updateAsset(
  ctx: AdminContext,
  id: string,
  input: AssetInput & { archived?: boolean | undefined },
): Promise<AssetView> {
  await requireManage(ctx);
  const current = await ctx.db.maintAsset.findFirst({ where: { id }, select: { folderId: true } });
  if (current === null) throw notFound();
  await assertFreeCode(ctx.db, input.code, id);
  await assertParent(ctx.db, id, input.parentId);
  const folder = await liveFolder(ctx, current.folderId);
  const row = await ctx.db.maintAsset.update({
    where: { id },
    data: {
      ...data(input),
      ...(folder === null ? { folderId: await assetFolder(ctx, input.code, input.name) } : {}),
      ...(input.archived === undefined ? {} : { archivedAt: input.archived ? new Date() : null }),
    },
    select,
  });
  await auditAdmin(ctx, {
    action: input.archived === true ? "maintenance.asset.archive" : "maintenance.asset.update",
    entityType: "MaintAsset",
    entityId: id,
    metadata: { code: row.code, name: row.name },
  });
  return (await views(ctx, [row]))[0] as AssetView;
}

/** The QR to stick on the machine: it opens «Report a breakdown» with this asset chosen. */
export async function assetQr(
  ctx: AdminContext,
  appUrl: string,
  id: string,
  format: "png" | "svg",
): Promise<{ contentType: string; fileName: string; body: Buffer | string }> {
  await requireAny(ctx);
  const row = await ctx.db.maintAsset.findFirst({ where: { id }, select: { code: true } });
  if (row === null) throw notFound();
  const url = `${appUrl}/app/${ctx.tenant.workspaceSlug}/mantenimiento/avisar?equipo=${id}`;
  const fileName = `qr-${row.code}.${format}`;
  return format === "png"
    ? { contentType: "image/png", fileName, body: renderPng(url) }
    : { contentType: "image/svg+xml", fileName, body: renderSvg(url) };
}
