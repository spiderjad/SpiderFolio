// Expiries of files and pages (docs/spec/vencimientos.md): one per element, with a responsible (a person
// or a department), notice days and a note. Seeing one needs seeing the element; setting it, editing the
// element or expirations.manage over what one sees. Lists only show what the person sees.
import { AppError, forbidden, notFound } from "../../lib/errors.ts";
import { pageOf, offsetArgs, type Page } from "../../lib/pagination.ts";
import { dayIn, zoneOf } from "../../lib/time-zone.ts";
import { expiryTexts } from "../../i18n/index.ts";
import { atLeast } from "../access/access.ts";
import { accessFor, levelOfNode } from "../access/access-context.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { whoCanSee } from "../documents/readings.core.ts";
import { toCsv } from "../../lib/csv.ts";
import { dayOf, DEFAULT_NOTICE_DAYS, setExpiry } from "./expiries.service.ts";
import { expiryState, type ExpiryState } from "./expiry-rules.ts";
import { NODE_EXPIRY } from "./node-expiry.ts";
import type { ExpiryFilters, SetNodeExpiryInput } from "./node-expiries.schemas.ts";

export const CSV_MAX = 10_000;
/** How many expiries are looked at for a list (filtered by access in memory). */
const MAX_ROWS = 5000;

export interface NodeExpiryView {
  dueOn: string;
  state: ExpiryState;
  responsible: { type: "person" | "department"; id: string; name: string } | null;
  noticeDays: number[];
  note: string | null;
  /** When it was last set (to propose the same term for a new version). */
  setAt: Date;
  /** The responsible person can't see the element (the app warns). */
  responsibleCantSee: boolean;
}

export interface ExpiryRow {
  node: {
    id: string;
    name: string;
    type: string;
    spaceId: string;
    spaceName: string;
    spaceDepartmentId: string | null;
    parentId: string | null;
  };
  dueOn: string;
  state: ExpiryState;
  responsible: { type: "person" | "department"; id: string; name: string } | null;
  note: string | null;
}

async function today(ctx: Pick<AdminContext, "db">): Promise<string> {
  const workspace = await ctx.db.workspace.findFirst({ where: {}, select: { settings: true } });
  return dayIn(new Date(), zoneOf(workspace?.settings));
}

async function loadNode(ctx: AdminContext, id: string) {
  const node = await ctx.db.node.findFirst({
    where: { id, trashedAt: null, type: { not: "FOLDER" } },
    select: { id: true, name: true, type: true, spaceId: true, parentId: true },
  });
  const level = node === null ? null : await levelOfNode(ctx, id);
  if (node === null || level === null) throw notFound();
  const canEdit =
    atLeast(level, "EDIT") ||
    (ctx.tenant.capabilities.includes("expirations.manage") && atLeast(level, "VIEW"));
  return { node, canEdit };
}

async function responsibleOf(
  ctx: Pick<AdminContext, "db">,
  rows: { responsibleId: string | null; responsibleDepartmentId: string | null }[],
) {
  const people = new Map(
    (
      await ctx.db.membership.findMany({
        where: {
          id: { in: rows.flatMap((r) => (r.responsibleId === null ? [] : [r.responsibleId])) },
        },
        select: { id: true, user: { select: { name: true } } },
      })
    ).map((row) => [row.id, row.user.name]),
  );
  const departments = new Map(
    (
      await ctx.db.department.findMany({
        where: {
          id: {
            in: rows.flatMap((r) =>
              r.responsibleDepartmentId === null ? [] : [r.responsibleDepartmentId],
            ),
          },
        },
        select: { id: true, name: true },
      })
    ).map((row) => [row.id, row.name]),
  );
  return (row: { responsibleId: string | null; responsibleDepartmentId: string | null }) =>
    row.responsibleId !== null
      ? {
          type: "person" as const,
          id: row.responsibleId,
          name: people.get(row.responsibleId) ?? "",
        }
      : row.responsibleDepartmentId !== null
        ? {
            type: "department" as const,
            id: row.responsibleDepartmentId,
            name: departments.get(row.responsibleDepartmentId) ?? "",
          }
        : null;
}

export async function getNodeExpiry(
  ctx: AdminContext,
  nodeId: string,
): Promise<{ expiry: NodeExpiryView | null; canEdit: boolean }> {
  const { canEdit } = await loadNode(ctx, nodeId);
  const row = await ctx.db.expiry.findFirst({
    where: { kind: NODE_EXPIRY, subjectId: nodeId, resolvedAt: null },
  });
  if (row === null) return { expiry: null, canEdit };
  const who = await responsibleOf(ctx, [row]);
  // The day it was last set, from the audit (updatedAt also moves when a notice goes out).
  const lastSet = await ctx.db.auditLog.findFirst({
    where: { entityType: "Node", entityId: nodeId, action: "node.expiry.set" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  const responsibleCantSee =
    row.responsibleId !== null &&
    !(await whoCanSee(ctx.db, nodeId, [row.responsibleId])).has(row.responsibleId);
  return {
    expiry: {
      dueOn: dayOf(row.dueOn),
      state: expiryState(await today(ctx), dayOf(row.dueOn), row.noticeDays),
      responsible: who(row),
      noticeDays: row.noticeDays,
      note: row.note,
      setAt: lastSet?.createdAt ?? row.createdAt,
      responsibleCantSee,
    },
    canEdit,
  };
}

export async function setNodeExpiry(
  ctx: AdminContext,
  nodeId: string,
  input: SetNodeExpiryInput,
): Promise<{ expiry: NodeExpiryView | null; canEdit: boolean }> {
  const { node, canEdit } = await loadNode(ctx, nodeId);
  if (!canEdit) throw forbidden();
  const responsible = input.responsible;
  if (responsible?.type === "person") {
    const found = await ctx.db.membership.count({
      where: { id: responsible.id, status: "ACTIVE" },
    });
    if (found === 0) throw notFound();
  } else if (responsible?.type === "department") {
    if ((await ctx.db.department.count({ where: { id: responsible.id } })) === 0) throw notFound();
  }
  await setExpiry(ctx.db, {
    kind: NODE_EXPIRY,
    subjectId: nodeId,
    dueOn: input.dueOn,
    responsibleId: responsible?.type === "person" ? responsible.id : null,
    responsibleDepartmentId: responsible?.type === "department" ? responsible.id : null,
    note: input.note ?? null,
    noticeDays: input.noticeDays ?? DEFAULT_NOTICE_DAYS,
  });
  await auditAdmin(ctx, {
    action: "node.expiry.set",
    entityType: "Node",
    entityId: nodeId,
    metadata: {
      name: node.name,
      dueOn: input.dueOn,
      responsible: responsible === null ? null : { ...responsible },
    },
  });
  return await getNodeExpiry(ctx, nodeId);
}

export async function removeNodeExpiry(ctx: AdminContext, nodeId: string): Promise<void> {
  const { node, canEdit } = await loadNode(ctx, nodeId);
  if (!canEdit) throw forbidden();
  const removed = await ctx.db.expiry.deleteMany({
    where: { kind: NODE_EXPIRY, subjectId: nodeId },
  });
  if (removed.count === 0) throw notFound();
  await auditAdmin(ctx, {
    action: "node.expiry.remove",
    entityType: "Node",
    entityId: nodeId,
    metadata: { name: node.name },
  });
}

/** Every visible element's expiry with the filters, soonest first. */
async function visibleRows(ctx: AdminContext, filters: ExpiryFilters): Promise<ExpiryRow[]> {
  const day = await today(ctx);
  const rows = await ctx.db.expiry.findMany({
    where: {
      kind: NODE_EXPIRY,
      resolvedAt: null,
      ...(filters.responsible === undefined ? {} : { responsibleId: filters.responsible }),
      ...(filters.from === undefined && filters.to === undefined
        ? {}
        : {
            dueOn: {
              ...(filters.from === undefined ? {} : { gte: new Date(`${filters.from}T00:00:00Z`) }),
              ...(filters.to === undefined ? {} : { lte: new Date(`${filters.to}T00:00:00Z`) }),
            },
          }),
    },
    orderBy: [{ dueOn: "asc" }, { id: "asc" }],
    take: MAX_ROWS,
  });
  const nodes = await ctx.db.node.findMany({
    where: {
      id: { in: rows.map((row) => row.subjectId) },
      trashedAt: null,
      ...(filters.space === undefined ? {} : { spaceId: filters.space }),
    },
    select: {
      id: true,
      name: true,
      type: true,
      spaceId: true,
      parentId: true,
      space: { select: { name: true, departmentId: true } },
    },
  });
  const access = await accessFor(ctx, { nodeIds: nodes.map((node) => node.id) });
  const byId = new Map(
    nodes.filter((node) => atLeast(access.ofNode(node.id), "VIEW")).map((node) => [node.id, node]),
  );
  const who = await responsibleOf(ctx, rows);
  return rows.flatMap((row) => {
    const node = byId.get(row.subjectId);
    if (node === undefined) return [];
    if (
      filters.department !== undefined &&
      row.responsibleDepartmentId !== filters.department &&
      node.space.departmentId !== filters.department
    ) {
      return [];
    }
    const state = expiryState(day, dayOf(row.dueOn), row.noticeDays);
    if (filters.status !== undefined && filters.status !== "all" && state !== filters.status)
      return [];
    return [
      {
        node: {
          id: node.id,
          name: node.name,
          type: node.type,
          spaceId: node.spaceId,
          spaceName: node.space.name,
          spaceDepartmentId: node.space.departmentId,
          parentId: node.parentId,
        },
        dueOn: dayOf(row.dueOn),
        state,
        responsible: who(row),
        note: row.note,
      },
    ];
  });
}

export async function listExpiries(
  ctx: AdminContext,
  query: ExpiryFilters & { page: number; pageSize: number; cursor?: string | undefined },
): Promise<Page<ExpiryRow>> {
  const rows = await visibleRows(ctx, query);
  const { skip, take } = offsetArgs(query);
  return pageOf(rows.slice(skip, skip + take), rows.length, query);
}

export async function exportExpiries(
  ctx: AdminContext,
  filters: ExpiryFilters,
): Promise<{ fileName: string; body: string }> {
  const rows = await visibleRows(ctx, filters);
  const t = expiryTexts.csv;
  if (rows.length > CSV_MAX) throw new AppError("BAD_REQUEST", { message: t.tooMany });
  const body = toCsv(
    [t.dueOn, t.element, t.space, t.state, t.responsible, t.note],
    rows.map((row) => [
      row.dueOn,
      row.node.name,
      row.node.spaceName,
      t.states[row.state],
      row.responsible?.name ?? "",
      row.note ?? "",
    ]),
  );
  await auditAdmin(ctx, {
    action: "expiries.export",
    entityType: "Expiry",
    metadata: { rows: rows.length, filters: { ...filters } },
  });
  return { fileName: t.fileName, body };
}

/** A space's visible expiries, for the explorer's badges. */
export async function spaceExpiries(
  ctx: AdminContext,
  spaceId: string,
): Promise<{ nodeId: string; dueOn: string; state: ExpiryState }[]> {
  const space = await ctx.db.space.findFirst({ where: { id: spaceId }, select: { id: true } });
  if (space === null) throw notFound();
  const rows = await visibleRows(ctx, { space: spaceId, status: "all" });
  return rows.map((row) => ({ nodeId: row.node.id, dueOn: row.dueOn, state: row.state }));
}

/** What the person has to see to as responsible (themselves, or a department they head): due soon or expired. */
export async function myExpiries(
  ctx: AdminContext,
): Promise<{ items: ExpiryRow[]; total: number }> {
  const led = (
    await ctx.db.departmentMember.findMany({
      where: { membershipId: ctx.tenant.membershipId, position: { in: ["HEAD", "DEPUTY"] } },
      select: { departmentId: true },
    })
  ).map((row) => row.departmentId);
  const rows = (await visibleRows(ctx, { status: "all" })).filter(
    (row) =>
      row.state !== "valid" &&
      row.responsible !== null &&
      ((row.responsible.type === "person" && row.responsible.id === ctx.tenant.membershipId) ||
        (row.responsible.type === "department" && led.includes(row.responsible.id))),
  );
  return { items: rows.slice(0, 20), total: rows.length };
}

/** People and departments to choose as responsible (for whoever can set the expiry). */
export async function responsibleOptions(
  ctx: AdminContext,
  nodeId: string,
  q: string | undefined,
): Promise<{
  people: { id: string; name: string; canSee: boolean }[];
  departments: { id: string; name: string }[];
}> {
  const { canEdit } = await loadNode(ctx, nodeId);
  if (!canEdit) throw forbidden();
  const text =
    q === undefined || q === "" ? undefined : { contains: q, mode: "insensitive" as const };
  const [members, departments] = await Promise.all([
    ctx.db.membership.findMany({
      where: { status: "ACTIVE", ...(text === undefined ? {} : { user: { name: text } }) },
      select: { id: true, user: { select: { name: true } } },
      orderBy: [{ user: { name: "asc" } }, { id: "asc" }],
      take: 20,
    }),
    ctx.db.department.findMany({
      where: text === undefined ? {} : { name: text },
      select: { id: true, name: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: 20,
    }),
  ]);
  const seeing = await whoCanSee(
    ctx.db,
    nodeId,
    members.map((row) => row.id),
  );
  return {
    people: members.map((row) => ({ id: row.id, name: row.user.name, canSee: seeing.has(row.id) })),
    departments,
  };
}

/** What the list's filters offer: only the spaces, departments and people in what the person sees. */
export async function expiryFilterOptions(ctx: AdminContext): Promise<{
  spaces: { id: string; name: string }[];
  departments: { id: string; name: string }[];
  people: { id: string; name: string }[];
}> {
  const rows = await visibleRows(ctx, { status: "all" });
  const spaces = new Map(rows.map((row) => [row.node.spaceId, row.node.spaceName]));
  const people = new Map(
    rows.flatMap((row) =>
      row.responsible?.type === "person"
        ? [[row.responsible.id, row.responsible.name] as const]
        : [],
    ),
  );
  const departmentIds = new Set(
    rows.flatMap((row) => [
      ...(row.responsible?.type === "department" ? [row.responsible.id] : []),
      ...(row.node.spaceDepartmentId === null ? [] : [row.node.spaceDepartmentId]),
    ]),
  );
  const departments = await ctx.db.department.findMany({
    where: { id: { in: [...departmentIds] } },
    select: { id: true, name: true },
  });
  const sorted = (entries: Iterable<readonly [string, string]>) =>
    [...entries].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  return {
    spaces: sorted(spaces),
    departments: sorted(departments.map((row) => [row.id, row.name] as const)),
    people: sorted(people),
  };
}
