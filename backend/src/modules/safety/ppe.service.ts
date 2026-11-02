// PPE (docs/spec/seguridad-salud.md, «EPIs»): the company's catalog, handouts signed by whoever receives
// them (never changed or deleted: voided with a reason), each person's current PPE with its replacement
// date and what their position requires that they don't have («Le falta»). A handout with a life sets
// an expiry («safety.ppe», ppe-expiry.ts); a new handout of the same item to the same person resolves
// the previous one.
import { AppError, forbidden, notFound } from "../../lib/errors.ts";
import { cleanName, nameKeyOf } from "../../lib/names.ts";
import { offsetArgs, pageOf, stableOrder, type Page } from "../../lib/pagination.ts";
import { dayIn, dayMonthsLater, endOfDayIn, startOfDayIn, zoneOf } from "../../lib/time-zone.ts";
import { safetyTexts } from "../../i18n/index.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { dayOf, resolveExpiry, setExpiry } from "../expiries/expiries.service.ts";
import { expiryState, type ExpiryState } from "../expiries/expiry-rules.ts";
import {
  assertSeesPerson,
  canManageSafety,
  requireSafety,
  visiblePeople,
} from "./safety-access.ts";
import { PPE_EXPIRY } from "./ppe-expiry.ts";
import type {
  CreateDeliveryInput,
  CreateItemInput,
  ListDeliveriesQuery,
  ListItemsQuery,
  UpdateItemInput,
} from "./ppe.schemas.ts";

export interface ItemView {
  id: string;
  name: string;
  category: string | null;
  hasSizes: boolean;
  lifeMonths: number | null;
  positionIds: string[];
  archived: boolean;
}

const itemSelect = {
  id: true,
  name: true,
  category: true,
  hasSizes: true,
  lifeMonths: true,
  positionIds: true,
  archivedAt: true,
} as const;

const itemView = (row: {
  id: string;
  name: string;
  category: string | null;
  hasSizes: boolean;
  lifeMonths: number | null;
  positionIds: string[];
  archivedAt: Date | null;
}): ItemView => ({
  id: row.id,
  name: row.name,
  category: row.category,
  hasSizes: row.hasSizes,
  lifeMonths: row.lifeMonths,
  positionIds: row.positionIds,
  archived: row.archivedAt !== null,
});

async function requireManager(ctx: AdminContext) {
  const settings = await requireSafety(ctx);
  if (!canManageSafety(ctx)) throw forbidden();
  return settings;
}

async function zoneOfCompany(ctx: Pick<AdminContext, "db">): Promise<string> {
  const workspace = await ctx.db.workspace.findFirst({ where: {}, select: { settings: true } });
  return zoneOf(workspace?.settings);
}

async function namesOf(ctx: Pick<AdminContext, "db">, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await ctx.db.membership.findMany({
    where: { id: { in: [...new Set(ids)] } },
    select: { id: true, user: { select: { name: true } } },
  });
  return new Map(rows.map((row) => [row.id, row.user.name]));
}

async function assertPositions(ctx: AdminContext, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  const found = await ctx.db.position.count({ where: { id: { in: [...new Set(ids)] } } });
  if (found !== new Set(ids).size) throw notFound();
}

async function assertItemNameFree(ctx: AdminContext, name: string, exceptId?: string) {
  const taken = await ctx.db.safetyItem.findFirst({
    where: {
      nameKey: nameKeyOf(name),
      ...(exceptId === undefined ? {} : { NOT: { id: exceptId } }),
    },
    select: { id: true },
  });
  if (taken !== null) {
    throw new AppError("CONFLICT", { message: safetyTexts.messages.itemNameTaken });
  }
}

// ─── Catalog ─────────────────────────────────────────────────────────────────────────────

export async function listItems(ctx: AdminContext, query: ListItemsQuery): Promise<Page<ItemView>> {
  await requireManager(ctx);
  const where = {
    ...(query.ids === undefined ? {} : { id: { in: query.ids } }),
    ...(query.status === "all"
      ? {}
      : { archivedAt: query.status === "archived" ? { not: null } : null }),
    ...(query.q === undefined || query.q === ""
      ? {}
      : { name: { contains: query.q, mode: "insensitive" as const } }),
  };
  const [rows, total] = await Promise.all([
    ctx.db.safetyItem.findMany({
      where,
      select: itemSelect,
      orderBy: stableOrder({ name: query.dir }),
      ...offsetArgs(query),
    }),
    ctx.db.safetyItem.count({ where }),
  ]);
  return pageOf(rows.map(itemView), total, query);
}

export async function createItem(ctx: AdminContext, input: CreateItemInput): Promise<ItemView> {
  await requireManager(ctx);
  const name = cleanName(input.name);
  await assertItemNameFree(ctx, name);
  await assertPositions(ctx, input.positionIds);
  const row = await ctx.db.safetyItem.create({
    data: {
      name,
      nameKey: nameKeyOf(name),
      category: input.category ?? null,
      hasSizes: input.hasSizes,
      lifeMonths: input.lifeMonths ?? null,
      positionIds: [...new Set(input.positionIds)],
    },
    select: itemSelect,
  });
  await auditAdmin(ctx, {
    action: "safety.item.create",
    entityType: "SafetyItem",
    entityId: row.id,
    metadata: { name: row.name },
  });
  return itemView(row);
}

export async function updateItem(
  ctx: AdminContext,
  id: string,
  input: UpdateItemInput,
): Promise<ItemView> {
  await requireManager(ctx);
  const current = await ctx.db.safetyItem.findFirst({ where: { id }, select: itemSelect });
  if (current === null) throw notFound();
  const name = input.name === undefined ? undefined : cleanName(input.name);
  if (name !== undefined) await assertItemNameFree(ctx, name, id);
  if (input.positionIds !== undefined) await assertPositions(ctx, input.positionIds);
  const row = await ctx.db.safetyItem.update({
    where: { id },
    data: {
      ...(name === undefined ? {} : { name, nameKey: nameKeyOf(name) }),
      ...(input.category === undefined ? {} : { category: input.category }),
      ...(input.hasSizes === undefined ? {} : { hasSizes: input.hasSizes }),
      ...(input.lifeMonths === undefined ? {} : { lifeMonths: input.lifeMonths }),
      ...(input.positionIds === undefined ? {} : { positionIds: [...new Set(input.positionIds)] }),
      ...(input.archived === undefined
        ? {}
        : { archivedAt: input.archived ? (current.archivedAt ?? new Date()) : null }),
    },
    select: itemSelect,
  });
  await auditAdmin(ctx, {
    action: "safety.item.update",
    entityType: "SafetyItem",
    entityId: id,
    metadata: { before: { ...itemView(current) }, after: { ...itemView(row) } },
  });
  return itemView(row);
}

// ─── Handouts ────────────────────────────────────────────────────────────────────────────

/** The signature's bytes, if it really is a PNG. */
export function signatureBytes(dataUrl: string): Buffer {
  const bytes = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 100 || png.some((byte, index) => bytes[index] !== byte)) {
    throw new AppError("BAD_REQUEST", { message: safetyTexts.messages.signatureInvalid });
  }
  return bytes;
}

export interface DeliveryLineView {
  id: string;
  item: { id: string; name: string };
  quantity: number;
  size: string | null;
  replaceOn: string | null;
}

export interface DeliveryView {
  id: string;
  person: { id: string; name: string };
  deliveredBy: { id: string; name: string };
  deliveredAt: Date;
  note: string | null;
  lines: DeliveryLineView[];
  voided: { at: Date; by: { id: string; name: string }; reason: string } | null;
}

const deliverySelect = {
  id: true,
  membershipId: true,
  deliveredById: true,
  deliveredAt: true,
  note: true,
  voidedAt: true,
  voidedById: true,
  voidReason: true,
  lines: {
    select: {
      id: true,
      quantity: true,
      size: true,
      replaceOn: true,
      item: { select: { id: true, name: true } },
    },
    orderBy: { id: "asc" as const },
  },
} as const;

type DeliveryRow = {
  id: string;
  membershipId: string;
  deliveredById: string;
  deliveredAt: Date;
  note: string | null;
  voidedAt: Date | null;
  voidedById: string | null;
  voidReason: string | null;
  lines: {
    id: string;
    quantity: number;
    size: string | null;
    replaceOn: Date | null;
    item: { id: string; name: string };
  }[];
};

async function deliveryViews(ctx: AdminContext, rows: DeliveryRow[]): Promise<DeliveryView[]> {
  const names = await namesOf(
    ctx,
    rows.flatMap((row) => [
      row.membershipId,
      row.deliveredById,
      ...(row.voidedById === null ? [] : [row.voidedById]),
    ]),
  );
  const who = (id: string) => ({ id, name: names.get(id) ?? "" });
  return rows.map((row) => ({
    id: row.id,
    person: who(row.membershipId),
    deliveredBy: who(row.deliveredById),
    deliveredAt: row.deliveredAt,
    note: row.note,
    lines: row.lines.map((line) => ({
      id: line.id,
      item: line.item,
      quantity: line.quantity,
      size: line.size,
      replaceOn: line.replaceOn === null ? null : dayOf(line.replaceOn),
    })),
    voided:
      row.voidedAt === null || row.voidedById === null
        ? null
        : { at: row.voidedAt, by: who(row.voidedById), reason: row.voidReason ?? "" },
  }));
}

export async function createDelivery(
  ctx: AdminContext,
  input: CreateDeliveryInput,
): Promise<DeliveryView> {
  await requireManager(ctx);
  const person = await ctx.db.membership.findFirst({
    where: { id: input.membershipId, status: "ACTIVE" },
    select: { id: true },
  });
  if (person === null) throw notFound();
  const itemIds = input.lines.map((line) => line.itemId);
  if (new Set(itemIds).size !== itemIds.length) {
    throw new AppError("BAD_REQUEST", { message: safetyTexts.messages.repeatedItem });
  }
  const items = await ctx.db.safetyItem.findMany({
    where: { id: { in: itemIds } },
    select: itemSelect,
  });
  if (items.length !== itemIds.length) throw notFound();
  const byId = new Map(items.map((item) => [item.id, item]));
  for (const line of input.lines) {
    const item = byId.get(line.itemId);
    if (item === undefined) throw notFound();
    if (item.archivedAt !== null) {
      throw new AppError("BAD_REQUEST", { message: safetyTexts.messages.itemArchived });
    }
    if (item.hasSizes && (line.size ?? null) === null) {
      throw new AppError("BAD_REQUEST", { message: safetyTexts.messages.sizeRequired(item.name) });
    }
  }
  const signature = signatureBytes(input.signature);
  const zone = await zoneOfCompany(ctx);
  const now = new Date();
  const replaceOn = (months: number | null) =>
    months === null ? null : dayIn(dayMonthsLater(now, months, zone), zone);
  const created = await ctx.db.$transaction(async (tx) => {
    const delivery = await tx.safetyDelivery.create({
      data: {
        membershipId: person.id,
        deliveredById: ctx.tenant.membershipId,
        deliveredAt: now,
        note: input.note ?? null,
        signature: new Uint8Array(signature),
      },
      select: { id: true },
    });
    const lines = await tx.safetyDeliveryLine.createManyAndReturn({
      data: input.lines.map((line) => {
        const item = byId.get(line.itemId);
        const day = replaceOn(item?.lifeMonths ?? null);
        return {
          deliveryId: delivery.id,
          itemId: line.itemId,
          quantity: line.quantity,
          size: item?.hasSizes === true ? (line.size ?? null) : null,
          replaceOn: day === null ? null : new Date(`${day}T00:00:00Z`),
        };
      }),
      select: { id: true, itemId: true, replaceOn: true },
    });
    // What this person had of the same items is replaced: no more notices for it.
    const previous = await tx.safetyDeliveryLine.findMany({
      where: {
        itemId: { in: itemIds },
        deliveryId: { not: delivery.id },
        delivery: { membershipId: person.id },
      },
      select: { id: true },
    });
    for (const line of previous) {
      await resolveExpiry(tx, PPE_EXPIRY, line.id);
    }
    for (const line of lines) {
      if (line.replaceOn === null) continue;
      await setExpiry(tx, {
        kind: PPE_EXPIRY,
        subjectId: line.id,
        dueOn: dayOf(line.replaceOn),
        membershipId: person.id,
        responsibleId: ctx.tenant.membershipId,
      });
    }
    return delivery;
  });
  await auditAdmin(ctx, {
    action: "safety.delivery.create",
    entityType: "SafetyDelivery",
    entityId: created.id,
    metadata: {
      membershipId: person.id,
      lines: input.lines.map((line) => ({ itemId: line.itemId, quantity: line.quantity })),
    },
  });
  return await getDelivery(ctx, created.id);
}

export async function listDeliveries(
  ctx: AdminContext,
  query: ListDeliveriesQuery,
): Promise<Page<DeliveryView>> {
  await requireSafety(ctx);
  const visible = await visiblePeople(ctx);
  const zone = await zoneOfCompany(ctx);
  const people =
    query.person === undefined
      ? visible
      : visible === null || visible.includes(query.person)
        ? [query.person]
        : [];
  const where = {
    ...(people === null ? {} : { membershipId: { in: people } }),
    ...(query.item === undefined ? {} : { lines: { some: { itemId: query.item } } }),
    ...(query.status === "all"
      ? {}
      : { voidedAt: query.status === "voided" ? { not: null } : null }),
    ...(query.from === undefined && query.to === undefined
      ? {}
      : {
          deliveredAt: {
            ...(query.from === undefined ? {} : { gte: startOfDayIn(query.from, zone) }),
            ...(query.to === undefined ? {} : { lte: endOfDayIn(query.to, zone) }),
          },
        }),
  };
  const [rows, total] = await Promise.all([
    ctx.db.safetyDelivery.findMany({
      where,
      select: deliverySelect,
      orderBy: stableOrder({ deliveredAt: query.dir }),
      ...offsetArgs(query),
    }),
    ctx.db.safetyDelivery.count({ where }),
  ]);
  return pageOf(await deliveryViews(ctx, rows), total, query);
}

async function loadDelivery(ctx: AdminContext, id: string): Promise<DeliveryRow> {
  await requireSafety(ctx);
  const row = await ctx.db.safetyDelivery.findFirst({ where: { id }, select: deliverySelect });
  if (row === null) throw notFound();
  const visible = await visiblePeople(ctx);
  if (visible !== null && !visible.includes(row.membershipId)) throw notFound();
  return row;
}

export async function getDelivery(ctx: AdminContext, id: string): Promise<DeliveryView> {
  const [view] = await deliveryViews(ctx, [await loadDelivery(ctx, id)]);
  if (view === undefined) throw notFound();
  return view;
}

export async function deliverySignature(ctx: AdminContext, id: string): Promise<Uint8Array> {
  await loadDelivery(ctx, id);
  const row = await ctx.db.safetyDelivery.findFirst({ where: { id }, select: { signature: true } });
  if (row === null) throw notFound();
  return row.signature;
}

export async function voidDelivery(
  ctx: AdminContext,
  id: string,
  reason: string,
): Promise<DeliveryView> {
  await requireManager(ctx);
  const row = await loadDelivery(ctx, id);
  if (row.voidedAt !== null) {
    throw new AppError("CONFLICT", { message: safetyTexts.messages.alreadyVoided });
  }
  await ctx.db.$transaction(async (tx) => {
    await tx.safetyDelivery.update({
      where: { id },
      data: { voidedAt: new Date(), voidedById: ctx.tenant.membershipId, voidReason: reason },
    });
    for (const line of row.lines) await resolveExpiry(tx, PPE_EXPIRY, line.id);
  });
  await auditAdmin(ctx, {
    action: "safety.delivery.void",
    entityType: "SafetyDelivery",
    entityId: id,
    metadata: { membershipId: row.membershipId, reason },
  });
  return await getDelivery(ctx, id);
}

// ─── A person's PPE ──────────────────────────────────────────────────────────────────────

export interface CurrentPpe {
  item: { id: string; name: string };
  quantity: number;
  size: string | null;
  deliveryId: string;
  deliveredAt: Date;
  replaceOn: string | null;
  state: ExpiryState;
}

export interface PersonPpe {
  person: { id: string; name: string; position: { id: string; name: string } | null };
  current: CurrentPpe[];
  /** Required by their position and not held, or held but expired. */
  missing: { id: string; name: string; expired: boolean }[];
  canDeliver: boolean;
}

export async function personPpe(ctx: AdminContext, membershipId: string): Promise<PersonPpe> {
  await requireSafety(ctx);
  await assertSeesPerson(ctx, membershipId);
  const zone = await zoneOfCompany(ctx);
  const today = dayIn(new Date(), zone);
  const member = await ctx.db.membership.findFirst({
    where: { id: membershipId },
    select: { id: true, positionId: true, user: { select: { name: true } } },
  });
  if (member === null) throw notFound();
  const position =
    member.positionId === null
      ? null
      : await ctx.db.position.findFirst({
          where: { id: member.positionId },
          select: { id: true, name: true },
        });
  const lines = await ctx.db.safetyDeliveryLine.findMany({
    where: { delivery: { membershipId, voidedAt: null } },
    select: {
      quantity: true,
      size: true,
      replaceOn: true,
      item: { select: { id: true, name: true } },
      delivery: { select: { id: true, deliveredAt: true } },
    },
    orderBy: [{ delivery: { deliveredAt: "desc" } }, { id: "asc" }],
    take: 2000,
  });
  // The latest handout of each item is the one that counts.
  const latest = new Map<string, CurrentPpe>();
  for (const line of lines) {
    if (latest.has(line.item.id)) continue;
    const replaceOn = line.replaceOn === null ? null : dayOf(line.replaceOn);
    latest.set(line.item.id, {
      item: line.item,
      quantity: line.quantity,
      size: line.size,
      deliveryId: line.delivery.id,
      deliveredAt: line.delivery.deliveredAt,
      replaceOn,
      state: replaceOn === null ? "valid" : expiryState(today, replaceOn, [30, 7, 0]),
    });
  }
  const required =
    position === null
      ? []
      : await ctx.db.safetyItem.findMany({
          where: { archivedAt: null, positionIds: { has: position.id } },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        });
  const missing = required.flatMap((item) => {
    const held = latest.get(item.id);
    if (held === undefined) return [{ ...item, expired: false }];
    return held.state === "expired" ? [{ ...item, expired: true }] : [];
  });
  return {
    person: { id: member.id, name: member.user.name, position },
    current: [...latest.values()].sort((a, b) => a.item.name.localeCompare(b.item.name, "es")),
    missing,
    canDeliver: canManageSafety(ctx),
  };
}
