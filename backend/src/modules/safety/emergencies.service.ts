// Emergencies and drills (docs/spec/seguridad-salud.md, «Emergencias y simulacros»): the emergency plan
// as a controlled document of type PEM (yearly review), the emergency team (roles, each with the
// training it requires, and the people in them) and the drills, with the measures they lead to (origin
// DRILL in the planning) and a yearly reminder (`safety.drill` expiry) one year after the last one.
//
// Who does what: safety.manage manages the team and the drills; everyone sees their own emergency role
// on their sheet.
import { AppError, forbidden, notFound } from "../../lib/errors.ts";
import { cleanName, nameKeyOf } from "../../lib/names.ts";
import { offsetArgs, pageOf, stableOrder, type Page } from "../../lib/pagination.ts";
import { dayIn, zoneOf } from "../../lib/time-zone.ts";
import { readWorkspaceLocale, withLocale } from "../../i18n/locales.ts";
import { safetyTexts } from "../../i18n/index.ts";
import type { Prisma } from "../../generated/prisma/client.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { dayOf, setExpiry } from "../expiries/expiries.service.ts";
import { expiryState } from "../expiries/expiry-rules.ts";
import { DRILL_EXPIRY, DRILL_SUBJECT } from "./drill-expiry.ts";
import { assertSeesPerson, canManageSafety, requireSafety } from "./safety-access.ts";
import type { SafetySettings } from "../workspaces/settings.ts";

/** The emergency plan's document type. */
export const EMERGENCY_PLAN_TYPE = "PEM";

type Scenario = "FIRE" | "EVACUATION" | "SPILL" | "AMMONIA" | "OTHER";

async function requireManager(ctx: AdminContext): Promise<SafetySettings> {
  const settings = await requireSafety(ctx);
  if (!canManageSafety(ctx)) throw forbidden();
  return settings;
}

async function today(ctx: Pick<AdminContext, "db">): Promise<string> {
  const workspace = await ctx.db.workspace.findFirst({ where: {}, select: { settings: true } });
  return dayIn(new Date(), zoneOf(workspace?.settings));
}

/**
 * The PEM document type and the default emergency roles, once (never over what the company has):
 * on the module's activation (and each settings save while it's on) and, for companies that had it on
 * before, the first time whoever manages it opens the Emergencias screen. Runs in the company's language.
 */
export async function ensureEmergencySetup(
  ctx: Pick<AdminContext, "db">,
  terms: SafetySettings["terms"],
): Promise<void> {
  const workspace = await ctx.db.workspace.findFirst({ where: {}, select: { settings: true } });
  await withLocale(readWorkspaceLocale(workspace?.settings), async () => {
    if ((await ctx.db.documentType.count({ where: { code: EMERGENCY_PLAN_TYPE } })) === 0) {
      await ctx.db.documentType.create({
        data: {
          code: EMERGENCY_PLAN_TYPE,
          name: safetyTexts.emergencyPlanType[terms],
          prefix: EMERGENCY_PLAN_TYPE,
          reviewMonths: 12,
          position: await ctx.db.documentType.count(),
        },
      });
    }
    // The default roles only if the company never had any (archived ones count).
    if ((await ctx.db.safetyEmergencyRole.count()) === 0) {
      await ctx.db.safetyEmergencyRole.createMany({
        skipDuplicates: true,
        data: safetyTexts.emergencyRoles[terms].map((name, position) => ({
          name,
          nameKey: nameKeyOf(name),
          position,
        })),
      });
    }
  });
}

// ─── The team ────────────────────────────────────────────────────────────────────────────

export type TrainingStatus = "valid" | "due_soon" | "expired" | "pending" | "none";

export interface TeamRole {
  id: string;
  name: string;
  course: { id: string; name: string } | null;
  archived: boolean;
  members: {
    id: string;
    person: { id: string; name: string };
    location: string | null;
    /** Their training for the role's course («none»: the role requires none). */
    training: TrainingStatus;
  }[];
}

export interface TeamView {
  roles: TeamRole[];
  /** The latest PEM document in force or in draft, if any. */
  plan: { id: string; spaceId: string; code: string; name: string; type: "PAGE" | "FILE" } | null;
  lastDrill: { id: string; date: string } | null;
  /** The day the yearly drill is due (a year after the last one). */
  nextDrillBy: string | null;
}

/** Each person's latest training state in some courses. */
async function trainingStates(
  ctx: AdminContext,
  pairs: { courseId: string; membershipId: string }[],
): Promise<Map<string, TrainingStatus>> {
  const result = new Map<string, TrainingStatus>();
  if (pairs.length === 0) return result;
  const rows = await ctx.db.safetyTraining.findMany({
    where: {
      courseId: { in: [...new Set(pairs.map((pair) => pair.courseId))] },
      membershipId: { in: [...new Set(pairs.map((pair) => pair.membershipId))] },
    },
    orderBy: { completedAt: "desc" },
    select: { courseId: true, membershipId: true, validUntil: true },
  });
  const day = await today(ctx);
  for (const row of rows) {
    const key = `${row.courseId}:${row.membershipId}`;
    if (result.has(key)) continue;
    result.set(
      key,
      row.validUntil === null ? "valid" : expiryState(day, dayOf(row.validUntil), [30, 7, 0]),
    );
  }
  return result;
}

async function courseNames(
  ctx: AdminContext,
  ids: string[],
): Promise<Map<string, { id: string; name: string }>> {
  if (ids.length === 0) return new Map();
  const courses = await ctx.db.safetyCourse.findMany({
    where: { id: { in: [...new Set(ids)] } },
    select: { id: true, nodeId: true },
  });
  const nodes = await ctx.db.node.findMany({
    where: { id: { in: courses.map((course) => course.nodeId) }, trashedAt: null },
    select: { id: true, name: true },
  });
  const nameOf = new Map(nodes.map((node) => [node.id, node.name]));
  return new Map(
    courses.flatMap((course) => {
      const name = nameOf.get(course.nodeId);
      return name === undefined ? [] : [[course.id, { id: course.id, name }] as const];
    }),
  );
}

export async function getTeam(ctx: AdminContext, archived: boolean): Promise<TeamView> {
  const settings = await requireManager(ctx);
  await ensureEmergencySetup(ctx, settings.terms);
  const roles = await ctx.db.safetyEmergencyRole.findMany({
    where: archived ? {} : { archivedAt: null },
    orderBy: [{ position: "asc" }, { id: "asc" }],
    take: 200,
    include: { members: { orderBy: { createdAt: "asc" }, take: 500 } },
  });
  const people = await ctx.db.membership.findMany({
    where: {
      id: { in: [...new Set(roles.flatMap((role) => role.members.map((m) => m.membershipId)))] },
    },
    select: { id: true, user: { select: { name: true } } },
  });
  const nameOf = new Map(people.map((person) => [person.id, person.user.name]));
  const courses = await courseNames(
    ctx,
    roles.flatMap((role) => (role.courseId === null ? [] : [role.courseId])),
  );
  const states = await trainingStates(
    ctx,
    roles.flatMap((role) =>
      role.courseId === null
        ? []
        : role.members.map((member) => ({
            courseId: role.courseId ?? "",
            membershipId: member.membershipId,
          })),
    ),
  );
  const plan = await ctx.db.controlledDocument.findFirst({
    where: { docType: EMERGENCY_PLAN_TYPE, node: { trashedAt: null } },
    orderBy: { createdAt: "desc" },
    select: {
      code: true,
      node: { select: { id: true, name: true, spaceId: true, type: true } },
    },
  });
  const last = await ctx.db.safetyDrill.findFirst({
    orderBy: [{ date: "desc" }, { id: "desc" }],
    select: { id: true, date: true },
  });
  const expiry = await ctx.db.expiry.findFirst({
    where: { kind: DRILL_EXPIRY, subjectId: DRILL_SUBJECT, resolvedAt: null },
    select: { dueOn: true },
  });
  return {
    roles: roles.map((role) => ({
      id: role.id,
      name: role.name,
      course: role.courseId === null ? null : (courses.get(role.courseId) ?? null),
      archived: role.archivedAt !== null,
      members: role.members.map((member) => ({
        id: member.id,
        person: { id: member.membershipId, name: nameOf.get(member.membershipId) ?? "" },
        location: member.location,
        training:
          role.courseId === null
            ? "none"
            : (states.get(`${role.courseId}:${member.membershipId}`) ?? "pending"),
      })),
    })),
    plan:
      plan === null
        ? null
        : {
            id: plan.node.id,
            spaceId: plan.node.spaceId,
            code: plan.code,
            name: plan.node.name,
            type: plan.node.type === "FILE" ? "FILE" : "PAGE",
          },
    lastDrill: last === null ? null : { id: last.id, date: dayOf(last.date) },
    nextDrillBy: expiry === null ? null : dayOf(expiry.dueOn),
  };
}

async function assertCourse(ctx: AdminContext, courseId: string | null): Promise<void> {
  if (courseId === null) return;
  const found = await ctx.db.safetyCourse.count({ where: { id: courseId } });
  if (found === 0) throw notFound();
}

async function assertRoleNameFree(ctx: AdminContext, name: string, exceptId?: string) {
  const taken = await ctx.db.safetyEmergencyRole.findFirst({
    where: {
      nameKey: nameKeyOf(name),
      ...(exceptId === undefined ? {} : { NOT: { id: exceptId } }),
    },
    select: { id: true },
  });
  if (taken !== null) {
    throw new AppError("CONFLICT", { message: safetyTexts.drills.messages.roleNameTaken });
  }
}

export async function createRole(
  ctx: AdminContext,
  input: { name: string; courseId: string | null },
): Promise<{ id: string }> {
  await requireManager(ctx);
  const name = cleanName(input.name);
  await assertRoleNameFree(ctx, name);
  await assertCourse(ctx, input.courseId);
  const last = await ctx.db.safetyEmergencyRole.findFirst({
    orderBy: { position: "desc" },
    select: { position: true },
  });
  const row = await ctx.db.safetyEmergencyRole.create({
    data: {
      name,
      nameKey: nameKeyOf(name),
      courseId: input.courseId,
      position: (last?.position ?? -1) + 1,
    },
    select: { id: true },
  });
  await auditAdmin(ctx, {
    action: "safety.emergency.role.create",
    entityType: "SafetyEmergencyRole",
    entityId: row.id,
    metadata: { name, courseId: input.courseId },
  });
  return row;
}

export async function updateRole(
  ctx: AdminContext,
  id: string,
  input: {
    name?: string | undefined;
    courseId?: string | null | undefined;
    archived?: boolean | undefined;
  },
): Promise<void> {
  await requireManager(ctx);
  const current = await ctx.db.safetyEmergencyRole.findFirst({ where: { id } });
  if (current === null) throw notFound();
  const name = input.name === undefined ? undefined : cleanName(input.name);
  if (name !== undefined) await assertRoleNameFree(ctx, name, id);
  if (input.courseId !== undefined) await assertCourse(ctx, input.courseId);
  await ctx.db.safetyEmergencyRole.update({
    where: { id },
    data: {
      ...(name === undefined ? {} : { name, nameKey: nameKeyOf(name) }),
      ...(input.courseId === undefined ? {} : { courseId: input.courseId }),
      ...(input.archived === undefined
        ? {}
        : { archivedAt: input.archived ? (current.archivedAt ?? new Date()) : null }),
    },
    select: { id: true },
  });
  await auditAdmin(ctx, {
    action: "safety.emergency.role.update",
    entityType: "SafetyEmergencyRole",
    entityId: id,
    metadata: { changed: Object.keys(input), name: name ?? current.name },
  });
}

export async function addMember(
  ctx: AdminContext,
  roleId: string,
  input: { membershipId: string; location: string | null },
): Promise<void> {
  await requireManager(ctx);
  const role = await ctx.db.safetyEmergencyRole.findFirst({
    where: { id: roleId, archivedAt: null },
    select: { id: true },
  });
  if (role === null) throw notFound();
  const person = await ctx.db.membership.count({
    where: { id: input.membershipId, status: "ACTIVE" },
  });
  if (person === 0) throw notFound();
  const existing = await ctx.db.safetyEmergencyMember.count({
    where: { roleId, membershipId: input.membershipId },
  });
  if (existing > 0) {
    throw new AppError("CONFLICT", { message: safetyTexts.drills.messages.alreadyMember });
  }
  const row = await ctx.db.safetyEmergencyMember.create({
    data: {
      roleId,
      membershipId: input.membershipId,
      location: input.location,
      createdById: ctx.tenant.membershipId,
    },
    select: { id: true },
  });
  await auditAdmin(ctx, {
    action: "safety.emergency.member.add",
    entityType: "SafetyEmergencyRole",
    entityId: roleId,
    metadata: { memberId: row.id, membershipId: input.membershipId },
  });
}

export async function removeMember(ctx: AdminContext, memberId: string): Promise<void> {
  await requireManager(ctx);
  const member = await ctx.db.safetyEmergencyMember.findFirst({
    where: { id: memberId },
    select: { id: true, roleId: true, membershipId: true },
  });
  if (member === null) throw notFound();
  await ctx.db.safetyEmergencyMember.delete({ where: { id: memberId } });
  await auditAdmin(ctx, {
    action: "safety.emergency.member.remove",
    entityType: "SafetyEmergencyRole",
    entityId: member.roleId,
    metadata: { membershipId: member.membershipId },
  });
}

/** Someone's emergency roles (their own, or someone they see on the module), for their sheet. */
export async function personEmergencyRoles(
  ctx: AdminContext,
  membershipId: string,
): Promise<
  { role: string; location: string | null; training: TrainingStatus; course: string | null }[]
> {
  await requireSafety(ctx);
  await assertSeesPerson(ctx, membershipId);
  const rows = await ctx.db.safetyEmergencyMember.findMany({
    where: { membershipId, role: { archivedAt: null } },
    select: { location: true, role: { select: { name: true, courseId: true } } },
    take: 50,
  });
  const courses = await courseNames(
    ctx,
    rows.flatMap((row) => (row.role.courseId === null ? [] : [row.role.courseId])),
  );
  const states = await trainingStates(
    ctx,
    rows.flatMap((row) =>
      row.role.courseId === null ? [] : [{ courseId: row.role.courseId, membershipId }],
    ),
  );
  return rows.map((row) => ({
    role: row.role.name,
    location: row.location,
    course: row.role.courseId === null ? null : (courses.get(row.role.courseId)?.name ?? null),
    training:
      row.role.courseId === null
        ? "none"
        : (states.get(`${row.role.courseId}:${membershipId}`) ?? "pending"),
  }));
}

// ─── Drills ──────────────────────────────────────────────────────────────────────────────

export interface DrillInput {
  date: string;
  scenario: Scenario;
  area: string | null;
  announced: boolean;
  participants: number | null;
  evacuationSeconds: number | null;
  incidents: string | null;
  observers: string | null;
  nodeId: string | null;
}

export interface DrillView extends Omit<DrillInput, "nodeId"> {
  id: string;
  /** The attached report, if it's still there. */
  document: {
    id: string;
    spaceId: string;
    name: string;
    type: "PAGE" | "FILE" | "FOLDER" | "FORM";
    parentId: string | null;
  } | null;
  actions: { total: number; open: number };
  createdBy: { id: string; name: string };
  createdAt: Date;
}

const drillSelect = {
  id: true,
  date: true,
  scenario: true,
  area: true,
  announced: true,
  participants: true,
  evacuationSeconds: true,
  incidents: true,
  observers: true,
  nodeId: true,
  createdById: true,
  createdAt: true,
  actions: { select: { doneAt: true } },
} as const;

type DrillRow = Prisma.SafetyDrillGetPayload<{ select: typeof drillSelect }>;

async function drillViews(ctx: AdminContext, rows: DrillRow[]): Promise<DrillView[]> {
  const nodeIds = rows.flatMap((row) => (row.nodeId === null ? [] : [row.nodeId]));
  const [nodes, people] = await Promise.all([
    nodeIds.length === 0
      ? Promise.resolve([])
      : ctx.db.node.findMany({
          where: { id: { in: nodeIds }, trashedAt: null },
          select: { id: true, name: true, spaceId: true, type: true, parentId: true },
        }),
    ctx.db.membership.findMany({
      where: { id: { in: [...new Set(rows.map((row) => row.createdById))] } },
      select: { id: true, user: { select: { name: true } } },
    }),
  ]);
  const nodeOf = new Map(nodes.map((node) => [node.id, node]));
  const nameOf = new Map(people.map((person) => [person.id, person.user.name]));
  return rows.map((row) => {
    const node = row.nodeId === null ? undefined : nodeOf.get(row.nodeId);
    return {
      id: row.id,
      date: dayOf(row.date),
      scenario: row.scenario,
      area: row.area,
      announced: row.announced,
      participants: row.participants,
      evacuationSeconds: row.evacuationSeconds,
      incidents: row.incidents,
      observers: row.observers,
      document: node === undefined ? null : node,
      actions: {
        total: row.actions.length,
        open: row.actions.filter((action) => action.doneAt === null).length,
      },
      createdBy: { id: row.createdById, name: nameOf.get(row.createdById) ?? "" },
      createdAt: row.createdAt,
    };
  });
}

async function assertNode(ctx: AdminContext, nodeId: string | null): Promise<void> {
  if (nodeId === null) return;
  const found = await ctx.db.node.count({ where: { id: nodeId, trashedAt: null } });
  if (found === 0) throw notFound();
}

/** The yearly reminder: one year after the latest drill, to whoever manages the module. */
async function syncDrillExpiry(ctx: AdminContext): Promise<void> {
  const last = await ctx.db.safetyDrill.findFirst({
    orderBy: [{ date: "desc" }, { id: "desc" }],
    select: { date: true },
  });
  if (last === null) return;
  const next = new Date(last.date);
  next.setUTCFullYear(next.getUTCFullYear() + 1);
  const plan = await ctx.db.controlledDocument.findFirst({
    where: { docType: EMERGENCY_PLAN_TYPE, node: { trashedAt: null } },
    orderBy: { createdAt: "desc" },
    select: { ownerDepartmentId: true },
  });
  await setExpiry(ctx.db, {
    kind: DRILL_EXPIRY,
    subjectId: DRILL_SUBJECT,
    dueOn: dayOf(next),
    responsibleDepartmentId: plan?.ownerDepartmentId ?? null,
    setById: ctx.tenant.membershipId,
  });
}

export async function createDrill(ctx: AdminContext, input: DrillInput): Promise<DrillView> {
  await requireManager(ctx);
  await assertNode(ctx, input.nodeId);
  const row = await ctx.db.safetyDrill.create({
    data: {
      ...input,
      date: new Date(`${input.date}T00:00:00Z`),
      createdById: ctx.tenant.membershipId,
    },
    select: { id: true },
  });
  await syncDrillExpiry(ctx);
  await auditAdmin(ctx, {
    action: "safety.drill.create",
    entityType: "SafetyDrill",
    entityId: row.id,
    metadata: { date: input.date, scenario: input.scenario },
  });
  return await getDrill(ctx, row.id);
}

export async function updateDrill(
  ctx: AdminContext,
  id: string,
  input: { [K in keyof DrillInput]?: DrillInput[K] | undefined },
): Promise<DrillView> {
  await requireManager(ctx);
  const current = await ctx.db.safetyDrill.count({ where: { id } });
  if (current === 0) throw notFound();
  if (input.nodeId !== undefined) await assertNode(ctx, input.nodeId);
  // Only what came (undefined means «unchanged»).
  const data = Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as Prisma.SafetyDrillUncheckedUpdateInput;
  if (input.date !== undefined) data.date = new Date(`${input.date}T00:00:00Z`);
  await ctx.db.safetyDrill.update({
    where: { id },
    data,
    select: { id: true },
  });
  if (input.date !== undefined) await syncDrillExpiry(ctx);
  await auditAdmin(ctx, {
    action: "safety.drill.update",
    entityType: "SafetyDrill",
    entityId: id,
    metadata: { changed: Object.keys(input) },
  });
  return await getDrill(ctx, id);
}

export async function getDrill(ctx: AdminContext, id: string): Promise<DrillView> {
  await requireManager(ctx);
  const row = await ctx.db.safetyDrill.findFirst({ where: { id }, select: drillSelect });
  if (row === null) throw notFound();
  const [view] = await drillViews(ctx, [row]);
  if (view === undefined) throw notFound();
  return view;
}

export async function listDrills(
  ctx: AdminContext,
  query: {
    page: number;
    pageSize: number;
    cursor?: string | undefined;
    dir: "asc" | "desc";
    scenario?: Scenario | undefined;
    from?: string | undefined;
    to?: string | undefined;
  },
): Promise<Page<DrillView>> {
  await requireManager(ctx);
  const where: Prisma.SafetyDrillWhereInput = {
    ...(query.scenario === undefined ? {} : { scenario: query.scenario }),
    ...(query.from === undefined && query.to === undefined
      ? {}
      : {
          date: {
            ...(query.from === undefined ? {} : { gte: new Date(`${query.from}T00:00:00Z`) }),
            ...(query.to === undefined ? {} : { lte: new Date(`${query.to}T00:00:00Z`) }),
          },
        }),
  };
  const [rows, total] = await Promise.all([
    ctx.db.safetyDrill.findMany({
      where,
      select: drillSelect,
      orderBy: stableOrder({ date: query.dir }),
      ...offsetArgs(query),
    }),
    ctx.db.safetyDrill.count({ where }),
  ]);
  return pageOf(await drillViews(ctx, rows), total, query);
}
