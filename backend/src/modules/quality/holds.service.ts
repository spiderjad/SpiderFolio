// Product on hold and the decision on it (docs/spec/calidad.md, «Producto retenido»): put on hold from a
// nonconformity (by whoever handles it) or alone (quality.manage); quality.manage decides — released,
// reworked, diverted or destroyed — with a note and their signature. The decision is never changed.
import { AppError, forbidden, notFound } from "../../lib/errors.ts";
import { offsetArgs, pageOf, stableOrder, type Page } from "../../lib/pagination.ts";
import { qualityTexts } from "../../i18n/index.ts";
import type { Prisma } from "../../generated/prisma/client.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { signatureBytes } from "../safety/ppe.service.ts";
import { canManageQuality, canViewQuality, requireQuality } from "./quality-access.ts";
import type { DecisionInput, HoldInput, ListHoldsQuery } from "./haccp.schemas.ts";
import { getNc } from "./ncs.service.ts";
import { assertLot } from "./lots.service.ts";

export interface HoldView {
  id: string;
  nc: { id: string; code: string; title: string } | null;
  product: string;
  lot: string | null;
  lotId: string | null;
  quantity: string | null;
  location: string | null;
  reason: string;
  status: "HELD" | "RELEASED" | "REWORKED" | "DIVERTED" | "DESTROYED";
  decision: {
    note: string | null;
    by: { id: string; name: string };
    at: Date;
    signed: boolean;
  } | null;
  createdBy: { id: string; name: string };
  createdAt: Date;
  /** The viewer may decide on it (quality.manage, still on hold). */
  canDecide: boolean;
}

const holdSelect = {
  id: true,
  product: true,
  lot: true,
  lotId: true,
  quantity: true,
  location: true,
  reason: true,
  status: true,
  decisionNote: true,
  decidedById: true,
  decidedAt: true,
  signature: true,
  createdById: true,
  createdAt: true,
  nc: { select: { id: true, year: true, number: true, title: true } },
} as const;

type HoldRow = Prisma.QualityHoldGetPayload<{ select: typeof holdSelect }>;

export async function holdViews(ctx: AdminContext, rows: HoldRow[]): Promise<HoldView[]> {
  const ids = [
    ...new Set(
      rows
        .flatMap((row) => [row.createdById, row.decidedById])
        .filter((id): id is string => id !== null),
    ),
  ];
  const people =
    ids.length === 0
      ? []
      : await ctx.db.membership.findMany({
          where: { id: { in: ids } },
          select: { id: true, user: { select: { name: true } } },
        });
  const nameOf = new Map(people.map((person) => [person.id, person.user.name]));
  const manage = canManageQuality(ctx);
  return rows.map((row) => ({
    id: row.id,
    nc:
      row.nc === null
        ? null
        : {
            id: row.nc.id,
            code: qualityTexts.code(row.nc.year, row.nc.number),
            title: row.nc.title,
          },
    product: row.product,
    lot: row.lot,
    lotId: row.lotId,
    quantity: row.quantity,
    location: row.location,
    reason: row.reason,
    status: row.status,
    decision:
      row.decidedAt === null || row.decidedById === null
        ? null
        : {
            note: row.decisionNote,
            by: { id: row.decidedById, name: nameOf.get(row.decidedById) ?? "" },
            at: row.decidedAt,
            signed: row.signature !== null,
          },
    createdBy: { id: row.createdById, name: nameOf.get(row.createdById) ?? "" },
    createdAt: row.createdAt,
    canDecide: manage && row.status === "HELD",
  }));
}

/** An NC's holds (its record shows them to whoever sees the NC). */
export async function holdsOfNc(ctx: AdminContext, ncId: string): Promise<HoldView[]> {
  const rows = await ctx.db.qualityHold.findMany({
    where: { ncId },
    select: holdSelect,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 100,
  });
  return await holdViews(ctx, rows);
}

/** Every hold, on hold first (quality.view). */
export async function listHolds(ctx: AdminContext, query: ListHoldsQuery): Promise<Page<HoldView>> {
  await requireQuality(ctx);
  if (!canViewQuality(ctx)) throw forbidden();
  const where: Prisma.QualityHoldWhereInput =
    query.status === "held"
      ? { status: "HELD" }
      : query.status === "decided"
        ? { NOT: { status: "HELD" } }
        : {};
  const [rows, total] = await Promise.all([
    ctx.db.qualityHold.findMany({
      where,
      select: holdSelect,
      orderBy: stableOrder({ createdAt: "desc" as const }),
      ...offsetArgs(query),
    }),
    ctx.db.qualityHold.count({ where }),
  ]);
  return pageOf(await holdViews(ctx, rows), total, query);
}

async function oneView(ctx: AdminContext, id: string): Promise<HoldView> {
  const row = await ctx.db.qualityHold.findFirst({ where: { id }, select: holdSelect });
  if (row === null) throw notFound();
  const [view] = await holdViews(ctx, [row]);
  if (view === undefined) throw notFound();
  return view;
}

export async function getHold(ctx: AdminContext, id: string): Promise<HoldView> {
  await requireQuality(ctx);
  const row = await ctx.db.qualityHold.findFirst({ where: { id }, select: { ncId: true } });
  if (row === null) throw notFound();
  if (!canViewQuality(ctx)) {
    // Beyond quality.view: only an NC's hold, for whoever sees that NC.
    if (row.ncId === null) throw notFound();
    await getNc(ctx, row.ncId);
  }
  return await oneView(ctx, id);
}

/** On hold: from an NC (whoever handles it) or alone (quality.manage). */
export async function createHold(ctx: AdminContext, input: HoldInput): Promise<HoldView> {
  await requireQuality(ctx);
  if (input.ncId === null) {
    if (!canManageQuality(ctx)) throw forbidden();
  } else {
    const nc = await getNc(ctx, input.ncId);
    if (nc.access === "read") throw forbidden();
    if (nc.status === "CLOSED" || nc.status === "CANCELLED") {
      throw new AppError("CONFLICT", { message: qualityTexts.messages.closed });
    }
  }
  await assertLot(ctx.db, input.lotId);
  const created = await ctx.db.$transaction(async (tx) => {
    const hold = await tx.qualityHold.create({
      data: { ...input, createdById: ctx.tenant.membershipId },
      select: { id: true },
    });
    if (input.ncId !== null) {
      await tx.qualityNcEvent.create({
        data: {
          ncId: input.ncId,
          kind: "hold_added",
          actorId: ctx.tenant.membershipId,
          data: { holdId: hold.id, product: input.product, lot: input.lot },
        },
      });
    }
    return hold;
  });
  await auditAdmin(ctx, {
    action: "quality.hold.create",
    entityType: "QualityHold",
    entityId: created.id,
    metadata: { ncId: input.ncId, lot: input.lot },
  });
  return await oneView(ctx, created.id);
}

/** The decision, signed (quality.manage); once. */
export async function decideHold(
  ctx: AdminContext,
  id: string,
  input: DecisionInput,
): Promise<HoldView> {
  await requireQuality(ctx);
  if (!canManageQuality(ctx)) throw forbidden();
  const current = await ctx.db.qualityHold.findFirst({
    where: { id },
    select: { status: true, ncId: true },
  });
  if (current === null) throw notFound();
  if (current.status !== "HELD") {
    throw new AppError("CONFLICT", { message: qualityTexts.haccpMessages.holdDecided });
  }
  const signature = signatureBytes(input.signature);
  await ctx.db.$transaction(async (tx) => {
    // Only a hold still on hold changes (two decisions at once: the second one finds nothing).
    const changed = await tx.qualityHold.updateMany({
      where: { id, status: "HELD" },
      data: {
        status: input.status,
        decisionNote: input.note,
        decidedById: ctx.tenant.membershipId,
        decidedAt: new Date(),
        signature: new Uint8Array(signature),
      },
    });
    if (changed.count === 0) {
      throw new AppError("CONFLICT", { message: qualityTexts.haccpMessages.holdDecided });
    }
    if (current.ncId !== null) {
      await tx.qualityNcEvent.create({
        data: {
          ncId: current.ncId,
          kind: "hold_decided",
          actorId: ctx.tenant.membershipId,
          data: { holdId: id, status: input.status },
        },
      });
    }
  });
  await auditAdmin(ctx, {
    action: "quality.hold.decide",
    entityType: "QualityHold",
    entityId: id,
    metadata: { status: input.status, ncId: current.ncId },
  });
  return await oneView(ctx, id);
}
