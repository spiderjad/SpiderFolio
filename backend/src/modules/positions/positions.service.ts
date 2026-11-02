// The company's job positions (docs/spec/seguridad-salud.md, «Puestos»): a list in Administration,
// one per person (Membership.positionId), used for obligations by position.
import { AppError, notFound } from "../../lib/errors.ts";
import { cleanName, nameKeyOf } from "../../lib/names.ts";
import { offsetArgs, pageOf, stableOrder, type Page } from "../../lib/pagination.ts";
import { positionMessages } from "../../i18n/index.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import type {
  CreatePositionInput,
  ListPositionsQuery,
  UpdatePositionInput,
} from "./positions.schemas.ts";

export interface PositionView {
  id: string;
  name: string;
  description: string | null;
  /** Active people with this position. */
  people: number;
}

const positionSelect = { id: true, name: true, description: true } as const;

async function withPeople(
  ctx: Pick<AdminContext, "db">,
  rows: { id: string; name: string; description: string | null }[],
): Promise<PositionView[]> {
  if (rows.length === 0) return [];
  const counts = await ctx.db.membership.groupBy({
    by: ["positionId"],
    where: { positionId: { in: rows.map((row) => row.id) }, status: "ACTIVE" },
    _count: { _all: true },
  });
  const byId = new Map(counts.map((count) => [count.positionId, count._count._all]));
  return rows.map((row) => ({ ...row, people: byId.get(row.id) ?? 0 }));
}

async function loadPosition(ctx: Pick<AdminContext, "db">, id: string) {
  const row = await ctx.db.position.findFirst({ where: { id }, select: positionSelect });
  if (row === null) throw notFound();
  return row;
}

async function assertNameFree(ctx: Pick<AdminContext, "db">, name: string, exceptId?: string) {
  const taken = await ctx.db.position.findFirst({
    where: {
      nameKey: nameKeyOf(name),
      ...(exceptId === undefined ? {} : { NOT: { id: exceptId } }),
    },
    select: { id: true },
  });
  if (taken !== null) throw new AppError("CONFLICT", { message: positionMessages.nameTaken });
}

export async function listPositions(
  ctx: AdminContext,
  query: ListPositionsQuery,
): Promise<Page<PositionView>> {
  const where = {
    ...(query.ids === undefined ? {} : { id: { in: query.ids } }),
    ...(query.q === undefined || query.q === ""
      ? {}
      : { name: { contains: query.q, mode: "insensitive" as const } }),
  };
  if (query.sort === "people") {
    // Sorting by people needs every position of the filter: a company's list is short.
    const all = await withPeople(
      ctx,
      await ctx.db.position.findMany({ where, select: positionSelect, take: 5000 }),
    );
    all.sort(
      (a, b) =>
        (query.dir === "asc" ? a.people - b.people : b.people - a.people) ||
        a.name.localeCompare(b.name, "es") ||
        a.id.localeCompare(b.id),
    );
    const { skip, take } = offsetArgs(query);
    return pageOf(all.slice(skip, skip + take), all.length, query);
  }
  const [rows, total] = await Promise.all([
    ctx.db.position.findMany({
      where,
      select: positionSelect,
      orderBy: stableOrder({ name: query.dir }),
      ...offsetArgs(query),
    }),
    ctx.db.position.count({ where }),
  ]);
  return pageOf(await withPeople(ctx, rows), total, query);
}

export async function createPosition(
  ctx: AdminContext,
  input: CreatePositionInput,
): Promise<PositionView> {
  const name = cleanName(input.name);
  await assertNameFree(ctx, name);
  const row = await ctx.db.position.create({
    data: { name, nameKey: nameKeyOf(name), description: input.description ?? null },
    select: positionSelect,
  });
  await auditAdmin(ctx, {
    action: "position.create",
    entityType: "Position",
    entityId: row.id,
    metadata: { name: row.name },
  });
  return { ...row, people: 0 };
}

export async function updatePosition(
  ctx: AdminContext,
  id: string,
  input: UpdatePositionInput,
): Promise<PositionView> {
  const current = await loadPosition(ctx, id);
  const name = input.name === undefined ? undefined : cleanName(input.name);
  if (name !== undefined) await assertNameFree(ctx, name, id);
  const row = await ctx.db.position.update({
    where: { id },
    data: {
      ...(name === undefined ? {} : { name, nameKey: nameKeyOf(name) }),
      ...(input.description === undefined ? {} : { description: input.description }),
    },
    select: positionSelect,
  });
  await auditAdmin(ctx, {
    action: "position.update",
    entityType: "Position",
    entityId: id,
    metadata: { before: { name: current.name }, after: { name: row.name } },
  });
  const [view] = await withPeople(ctx, [row]);
  if (view === undefined) throw notFound();
  return view;
}

/** Deletes the position: its people are left without one, in the same transaction. */
export async function deletePosition(ctx: AdminContext, id: string): Promise<void> {
  const current = await loadPosition(ctx, id);
  const people = await ctx.db.$transaction(async (tx) => {
    const cleared = await tx.membership.updateMany({
      where: { positionId: id },
      data: { positionId: null },
    });
    await tx.position.delete({ where: { id } });
    return cleared.count;
  });
  await auditAdmin(ctx, {
    action: "position.delete",
    entityType: "Position",
    entityId: id,
    metadata: { name: current.name, people },
  });
}

/** The position has to be one of this company's (forTenant limits it; otherwise 404). */
export async function assertPosition(ctx: Pick<AdminContext, "db">, id: string): Promise<void> {
  await loadPosition(ctx, id);
}
