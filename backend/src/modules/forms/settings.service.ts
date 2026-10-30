// How a form runs (docs/spec/formularios.md, phase 3): who's in charge and, for periodic forms, how
// often and who fills it in. The person in charge is told about non-conformities and periods left
// without a record, and sees every record. With nobody chosen, the heads of the space's department
// are in charge, or (a company space with no department) whoever created the form.
import type { TenantDb } from "../../db/tenant.ts";
import { formMessages } from "../../i18n/index.ts";
import { AppError, notFound } from "../../lib/errors.ts";
import { accessFor, levelOfNode, requireLevel } from "../access/access-context.ts";
import { atLeast } from "../access/access.ts";
import { companyZone, dayIn } from "../../lib/time-zone.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { whoCanSee } from "../documents/readings.core.ts";
import type { SettingsInput } from "./forms.schemas.ts";
import { periodOf, type Frequency, type Schedule } from "./periods.ts";

export interface FormSettingsView {
  responsible:
    | { type: "default"; people: { id: string; name: string }[] }
    | { type: "person"; id: string; name: string }
    | { type: "department"; id: string; name: string };
  frequency: Frequency;
  weekdays: number[];
  assignees: {
    people: { id: string; name: string }[];
    departments: { id: string; name: string }[];
  };
}

interface SettingsRow {
  responsibleMembershipId: string | null;
  responsibleDepartmentId: string | null;
  frequency: string;
  weekdays: number[];
  assigneeMembershipIds: string[];
  assigneeDepartmentIds: string[];
}

const NONE: SettingsRow = {
  responsibleMembershipId: null,
  responsibleDepartmentId: null,
  frequency: "none",
  weekdays: [],
  assigneeMembershipIds: [],
  assigneeDepartmentIds: [],
};

const frequencyOf = (value: string): Frequency =>
  value === "daily" || value === "weekly" || value === "monthly" ? value : "none";

export const scheduleOf = (row: Pick<SettingsRow, "frequency" | "weekdays">): Schedule => ({
  frequency: frequencyOf(row.frequency),
  weekdays: row.weekdays,
});

export async function settingsRow(db: TenantDb, nodeId: string): Promise<SettingsRow> {
  return (await db.formSettings.findFirst({ where: { nodeId } })) ?? NONE;
}

/** The heads (not deputies) of a department, still active. */
async function headsOf(db: TenantDb, departmentId: string): Promise<string[]> {
  const heads = await db.departmentMember.findMany({
    where: { departmentId, position: "HEAD", membership: { status: "ACTIVE" } },
    select: { membershipId: true },
  });
  return heads.map((head) => head.membershipId);
}

/** Who's in charge of a form right now (membership ids, active). */
export async function responsiblesOf(db: TenantDb, nodeId: string): Promise<string[]> {
  const settings = await settingsRow(db, nodeId);
  if (settings.responsibleMembershipId !== null) {
    const person = await db.membership.findFirst({
      where: { id: settings.responsibleMembershipId, status: "ACTIVE" },
      select: { id: true },
    });
    return person === null ? [] : [person.id];
  }
  if (settings.responsibleDepartmentId !== null) {
    return await headsOf(db, settings.responsibleDepartmentId);
  }
  const node = await db.node.findFirst({
    where: { id: nodeId },
    select: { createdById: true, space: { select: { departmentId: true } } },
  });
  if (node === null) return [];
  const heads = node.space.departmentId === null ? [] : await headsOf(db, node.space.departmentId);
  return heads.length > 0 ? heads : [node.createdById];
}

/** The people who fill a periodic form in: chosen ones and their departments' members who see it. */
export async function assigneesOf(
  db: TenantDb,
  nodeId: string,
  settings: SettingsRow,
): Promise<string[]> {
  const members =
    settings.assigneeDepartmentIds.length === 0
      ? []
      : await db.departmentMember.findMany({
          where: { departmentId: { in: settings.assigneeDepartmentIds } },
          select: { membershipId: true },
        });
  const candidates = [
    ...new Set([
      ...settings.assigneeMembershipIds,
      ...members.map((member) => member.membershipId),
    ]),
  ];
  const active = await db.membership.findMany({
    where: { id: { in: candidates }, status: "ACTIVE" },
    select: { id: true },
  });
  return [
    ...(await whoCanSee(
      db,
      nodeId,
      active.map((person) => person.id),
    )),
  ];
}

async function names(db: TenantDb, ids: string[]) {
  const rows = await db.membership.findMany({
    where: { id: { in: [...new Set(ids)] } },
    select: { id: true, user: { select: { name: true } } },
  });
  return new Map(rows.map((row) => [row.id, row.user.name]));
}

export async function settingsView(db: TenantDb, nodeId: string): Promise<FormSettingsView> {
  const row = await settingsRow(db, nodeId);
  const [people, departments, inCharge] = await Promise.all([
    names(db, [
      ...row.assigneeMembershipIds,
      ...(row.responsibleMembershipId === null ? [] : [row.responsibleMembershipId]),
    ]),
    db.department.findMany({
      where: {
        id: {
          in: [
            ...row.assigneeDepartmentIds,
            ...(row.responsibleDepartmentId === null ? [] : [row.responsibleDepartmentId]),
          ],
        },
      },
      select: { id: true, name: true },
    }),
    row.responsibleMembershipId === null && row.responsibleDepartmentId === null
      ? responsiblesOf(db, nodeId)
      : Promise.resolve([]),
  ]);
  const departmentName = new Map(departments.map((department) => [department.id, department.name]));
  const defaultNames = await names(db, inCharge);
  const responsible: FormSettingsView["responsible"] =
    row.responsibleMembershipId !== null
      ? {
          type: "person",
          id: row.responsibleMembershipId,
          name: people.get(row.responsibleMembershipId) ?? "",
        }
      : row.responsibleDepartmentId !== null
        ? {
            type: "department",
            id: row.responsibleDepartmentId,
            name: departmentName.get(row.responsibleDepartmentId) ?? "",
          }
        : {
            type: "default",
            people: inCharge.map((id) => ({ id, name: defaultNames.get(id) ?? "" })),
          };
  return {
    responsible,
    frequency: frequencyOf(row.frequency),
    weekdays: [...row.weekdays].sort((a, b) => a - b),
    assignees: {
      people: row.assigneeMembershipIds.flatMap((id) => {
        const name = people.get(id);
        return name === undefined ? [] : [{ id, name }];
      }),
      departments: row.assigneeDepartmentIds.flatMap((id) => {
        const name = departmentName.get(id);
        return name === undefined ? [] : [{ id, name }];
      }),
    },
  };
}

/** Changes how the form runs: EDIT on it, and every person and department of this company. */
export async function saveSettings(
  ctx: AdminContext,
  formId: string,
  input: SettingsInput,
): Promise<FormSettingsView> {
  const form = await ctx.db.node.findFirst({
    where: { id: formId, trashedAt: null, type: "FORM" },
    select: { id: true },
  });
  if (form === null) throw notFound();
  requireLevel(await levelOfNode(ctx, formId), "EDIT");
  const people = [
    ...new Set([
      ...input.assignees.people,
      ...(input.responsible.type === "person" ? [input.responsible.id] : []),
    ]),
  ];
  const departments = [
    ...new Set([
      ...input.assignees.departments,
      ...(input.responsible.type === "department" ? [input.responsible.id] : []),
    ]),
  ];
  const [foundPeople, foundDepartments] = await Promise.all([
    ctx.db.membership.count({ where: { id: { in: people }, status: "ACTIVE" } }),
    ctx.db.department.count({ where: { id: { in: departments } } }),
  ]);
  if (foundPeople !== people.length || foundDepartments !== departments.length) {
    throw new AppError("BAD_REQUEST", { message: formMessages.unknownPeople });
  }
  const periodic = input.frequency !== "none";
  const data = {
    responsibleMembershipId: input.responsible.type === "person" ? input.responsible.id : null,
    responsibleDepartmentId: input.responsible.type === "department" ? input.responsible.id : null,
    frequency: input.frequency,
    weekdays: input.frequency === "daily" ? [...new Set(input.weekdays)].sort((a, b) => a - b) : [],
    assigneeMembershipIds: periodic ? [...new Set(input.assignees.people)] : [],
    assigneeDepartmentIds: periodic ? [...new Set(input.assignees.departments)] : [],
  };
  await ctx.db.$transaction(async (tx) => {
    const existing = await tx.formSettings.findFirst({
      where: { nodeId: formId },
      select: { nodeId: true },
    });
    if (existing === null) await tx.formSettings.create({ data: { nodeId: formId, ...data } });
    else await tx.formSettings.updateMany({ where: { nodeId: formId }, data });
    await auditAdmin(
      { db: tx, info: ctx.info },
      {
        action: "form.settings.update",
        entityType: "Node",
        entityId: formId,
        metadata: {
          responsible: input.responsible.type,
          frequency: data.frequency,
          weekdays: data.weekdays,
          assignees: data.assigneeMembershipIds.length + data.assigneeDepartmentIds.length,
        },
      },
    );
  });
  return await settingsView(ctx.db, formId);
}

export interface PendingForm {
  formId: string;
  name: string;
  spaceId: string;
  periodKey: string;
  frequency: Frequency;
}

/**
 * The periodic forms the person has to fill in now: assigned to them (or one of their departments),
 * due today in the company's zone, without a record yet in this period, and that they can see.
 */
export async function pendingForMe(
  ctx: AdminContext,
  now: Date = new Date(),
): Promise<PendingForm[]> {
  const me = ctx.tenant.membershipId;
  const [rows, mine, zone] = await Promise.all([
    ctx.db.formSettings.findMany({
      where: { frequency: { not: "none" }, node: { trashedAt: null } },
      select: {
        nodeId: true,
        frequency: true,
        weekdays: true,
        assigneeMembershipIds: true,
        assigneeDepartmentIds: true,
        node: { select: { name: true, spaceId: true } },
      },
      take: 500,
    }),
    ctx.db.departmentMember.findMany({
      where: { membershipId: me },
      select: { departmentId: true },
    }),
    companyZone(ctx.db),
  ]);
  const myDepartments = new Set(mine.map((row) => row.departmentId));
  const today = dayIn(now, zone);
  const assigned = rows.filter(
    (row) =>
      row.assigneeMembershipIds.includes(me) ||
      row.assigneeDepartmentIds.some((id) => myDepartments.has(id)),
  );
  const access = await accessFor(ctx, { nodeIds: assigned.map((row) => row.nodeId) });
  const pending: PendingForm[] = [];
  for (const row of assigned) {
    const periodKey = periodOf(scheduleOf(row), today);
    if (periodKey === null || !atLeast(access.ofNode(row.nodeId), "VIEW")) continue;
    const done = await ctx.db.formRecord.count({
      where: { nodeId: row.nodeId, periodKey, voidedAt: null },
    });
    if (done > 0) continue;
    pending.push({
      formId: row.nodeId,
      name: row.node.name,
      spaceId: row.node.spaceId,
      periodKey,
      frequency: frequencyOf(row.frequency),
    });
  }
  return pending.sort((a, b) => a.name.localeCompare(b.name));
}
