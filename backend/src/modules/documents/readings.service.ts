// Lecturas obligatorias (módulo 6, parte 4): pedir que un departamento o una persona lea la versión
// vigente, «Leí y comprendo» por versión, cumplimiento y CSV. Quien confirma es siempre la propia
// persona (nadie confirma por otra, tampoco el conector MCP). Al publicar una versión nueva, los
// requisitos pasan a ella: hay que volver a leer.
import type { NodeType } from "../../generated/prisma/client.ts";
import type { TenantDb } from "../../db/tenant.ts";
import { toCsv } from "../../lib/csv.ts";
import { AppError, forbidden, notFound } from "../../lib/errors.ts";
import { contentMessages, readingExportLabels } from "../../i18n/index.ts";
import { offsetArgs, pageOf, type Page } from "../../lib/pagination.ts";
import { accessActorOf, atLeast } from "../access/access.ts";
import { accessFor, levelOfNode, requireLevel } from "../access/access-context.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { createDocumentNotices } from "../notifications/notifications.service.ts";
import { assertSpaceWritable } from "../spaces/spaces.service.ts";
import { setPermission, type SharingDeps } from "../access/sharing.service.ts";
import type { ApprovalDeps } from "./approvals.service.ts";
import type {
  AccessGapsQuery,
  GrantReadingAccessInput,
  MyReadingsQuery,
  ReadingsQuery,
  RemindInput,
  RequirementInput,
} from "./documents.schemas.ts";
import {
  CARRY_OVER_DAYS,
  currentReadings,
  expandRequirements,
  readingPeopleOf,
  summarize,
  whoCanSee,
  type FullRequirement,
  type ReadingStatus,
} from "./readings.core.ts";

/** Quién puede pedir lecturas: la capacidad documents.require_reading, o un jefe dentro de su área. */
function readingScope(ctx: AdminContext): {
  unrestricted: boolean;
  departments: ReadonlySet<string>;
} {
  if (ctx.actor.capabilities.includes("documents.require_reading")) {
    return { unrestricted: true, departments: new Set() };
  }
  if (ctx.tenant.ledScope.size > 0) {
    return { unrestricted: false, departments: new Set(ctx.tenant.ledScope.keys()) };
  }
  throw forbidden();
}

async function publishedDocument(ctx: AdminContext, nodeId: string) {
  const node = await ctx.db.node.findFirst({
    where: { id: nodeId, trashedAt: null },
    select: { id: true, spaceId: true, type: true },
  });
  if (node === null) throw notFound();
  requireLevel(await levelOfNode(ctx, nodeId), "VIEW");
  const controlled = await ctx.db.controlledDocument.findFirst({ where: { nodeId } });
  if (controlled === null) {
    throw new AppError("BAD_REQUEST", { message: contentMessages.notControlled });
  }
  return { node, controlled, version: controlled.publishedVersion };
}

/** Pide la lectura de la versión vigente a un departamento (con o sin subáreas) o a una persona. */
export async function addRequirement(
  ctx: AdminContext,
  deps: ApprovalDeps,
  nodeId: string,
  input: RequirementInput,
): Promise<void> {
  const { node, controlled, version } = await publishedDocument(ctx, nodeId);
  const scope = readingScope(ctx);
  await assertSpaceWritable(ctx, node.spaceId);
  if (version === null) {
    throw new AppError("CONFLICT", { message: contentMessages.nothingPublished });
  }
  if ((input.departmentId === undefined) === (input.membershipId === undefined)) {
    throw new AppError("BAD_REQUEST", { message: contentMessages.subjectRequired });
  }
  if (input.departmentId !== undefined) {
    if ((await ctx.db.department.count({ where: { id: input.departmentId } })) === 0) {
      throw notFound();
    }
    if (!scope.unrestricted && !scope.departments.has(input.departmentId)) throw forbidden();
  } else if (input.membershipId !== undefined) {
    const person = await ctx.db.membership.findFirst({
      where: { id: input.membershipId, status: "ACTIVE" },
      select: { departments: { select: { departmentId: true } } },
    });
    if (person === null) {
      throw new AppError("BAD_REQUEST", { message: contentMessages.memberNotActive });
    }
    if (
      !scope.unrestricted &&
      !person.departments.some((member) => scope.departments.has(member.departmentId))
    ) {
      throw forbidden();
    }
  }
  const before = await currentReadings(ctx.db, nodeId, version);
  const dueAt = input.dueAt ?? null;
  const existing = await ctx.db.readRequirement.findFirst({
    where: {
      nodeId,
      version,
      ...(input.departmentId === undefined
        ? { membershipId: input.membershipId ?? "" }
        : { departmentId: input.departmentId }),
    },
    select: { id: true },
  });
  await ctx.db.$transaction(async (tx) => {
    if (existing === null) {
      await tx.readRequirement.create({
        data: {
          nodeId,
          version,
          ...(input.departmentId === undefined
            ? { membershipId: input.membershipId ?? "" }
            : { departmentId: input.departmentId }),
          includeSubareas: input.departmentId !== undefined && input.includeSubareas === true,
          dueAt,
          createdById: ctx.tenant.membershipId,
        },
      });
    } else {
      await tx.readRequirement.update({
        where: { id: existing.id },
        data: {
          dueAt,
          ...(input.departmentId !== undefined && input.includeSubareas !== undefined
            ? { includeSubareas: input.includeSubareas }
            : {}),
        },
      });
    }
    await auditAdmin(
      { db: tx, info: ctx.info },
      {
        action: "document.reading.require",
        entityType: "Node",
        entityId: nodeId,
        metadata: {
          code: controlled.code,
          version,
          ...(input.departmentId === undefined
            ? { membershipId: input.membershipId ?? "" }
            : { departmentId: input.departmentId }),
        },
      },
    );
  });
  // Aviso a quienes se suman a la lista y todavía no confirmaron.
  const after = await currentReadings(ctx.db, nodeId, version);
  const fresh = [...after.required.keys()].filter(
    (id) => !before.required.has(id) && !after.acks.has(id),
  );
  const visible = await whoCanSee(ctx.db, nodeId, fresh);
  await createDocumentNotices(ctx.db, deps.jobs, {
    kind: "reading_required",
    actorId: ctx.tenant.membershipId,
    recipients: fresh.filter((id) => visible.has(id)),
    nodeId,
    version,
    dueAt,
  });
}

export async function removeRequirement(
  ctx: AdminContext,
  nodeId: string,
  requirementId: string,
): Promise<void> {
  const { node, controlled } = await publishedDocument(ctx, nodeId);
  const scope = readingScope(ctx);
  await assertSpaceWritable(ctx, node.spaceId);
  const row = await ctx.db.readRequirement.findFirst({ where: { id: requirementId, nodeId } });
  if (row === null) throw notFound();
  if (
    !scope.unrestricted &&
    (row.departmentId === null || !scope.departments.has(row.departmentId))
  ) {
    throw forbidden();
  }
  await ctx.db.$transaction(async (tx) => {
    await tx.readRequirement.delete({ where: { id: row.id } });
    await auditAdmin(
      { db: tx, info: ctx.info },
      {
        action: "document.reading.remove",
        entityType: "Node",
        entityId: nodeId,
        metadata: { code: controlled.code, version: row.version },
      },
    );
  });
}

/** «Leí y comprendo» de la versión vigente. Solo la propia persona, y solo si debe leerla y la ve. */
export async function acknowledge(ctx: AdminContext, nodeId: string): Promise<void> {
  const { controlled, version } = await publishedDocument(ctx, nodeId);
  if (version === null)
    throw new AppError("CONFLICT", { message: contentMessages.nothingPublished });
  const me = ctx.tenant.membershipId;
  const { required } = await currentReadings(ctx.db, nodeId, version);
  if (!required.has(me)) throw forbidden();
  await ctx.db.$transaction(async (tx) => {
    const done = await tx.readAcknowledgment.findFirst({
      where: { nodeId, version, membershipId: me },
      select: { id: true },
    });
    if (done !== null) return;
    await tx.readAcknowledgment.create({ data: { nodeId, version, membershipId: me } });
    await auditAdmin(
      { db: tx, info: ctx.info },
      {
        action: "document.read",
        entityType: "Node",
        entityId: nodeId,
        metadata: { code: controlled.code, version },
      },
    );
  });
}

// ─── Estado de mis lecturas en un documento ──────────────────────────────────────────────

export interface ReadingMine {
  required: boolean;
  acknowledged: boolean;
  dueAt: Date | null;
  /** La versión anterior que la persona ya leyó (para ver qué cambió desde entonces). */
  readVersion: number | null;
  /** Motivo del cambio de la versión vigente, escrito al publicarla. */
  changeReason: string | null;
}

/** Si la persona debe leer este documento y si ya lo hizo (para el botón «Leí y comprendo»). */
export async function myReadingOf(ctx: AdminContext, nodeId: string): Promise<ReadingMine | null> {
  const controlled = await ctx.db.controlledDocument.findFirst({
    where: { nodeId },
    select: { publishedVersion: true },
  });
  if (controlled?.publishedVersion == null) return null;
  const { required, acks } = await currentReadings(ctx.db, nodeId, controlled.publishedVersion);
  const mine = required.get(ctx.tenant.membershipId);
  const acknowledged = acks.has(ctx.tenant.membershipId);
  let readVersion: number | null = null;
  let changeReason: string | null = null;
  if (mine !== undefined && !acknowledged) {
    const [previous, current] = await Promise.all([
      ctx.db.readAcknowledgment.findFirst({
        where: {
          nodeId,
          membershipId: ctx.tenant.membershipId,
          version: { lt: controlled.publishedVersion },
        },
        orderBy: { version: "desc" },
        select: { version: true },
      }),
      ctx.db.documentVersion.findFirst({
        where: { nodeId, version: controlled.publishedVersion },
        select: { changeReason: true },
      }),
    ]);
    readVersion = previous?.version ?? null;
    changeReason = current?.changeReason ?? null;
  }
  return {
    required: mine !== undefined,
    acknowledged,
    dueAt: mine?.dueAt ?? null,
    readVersion,
    changeReason,
  };
}

// ─── Cumplimiento de un documento ────────────────────────────────────────────────────────

export type { ReadingStatus };

export interface ReadingPerson {
  membershipId: string;
  name: string;
  status: ReadingStatus;
  readAt: Date | null;
  dueAt: Date | null;
}

export interface ReadingsOverview {
  version: number | null;
  requirements: {
    id: string;
    subject: { type: "person" | "department"; id: string; name: string };
    includeSubareas: boolean;
    dueAt: Date | null;
  }[];
  summary: { total: number; read: number; pending: number; overdue: number; noAccess: number };
  people: Page<ReadingPerson>;
}

const STATUS_ORDER: Record<ReadingStatus, number> = {
  overdue: 0,
  pending: 1,
  noAccess: 2,
  read: 3,
};

async function allPeople(
  db: TenantDb,
  nodeId: string,
  version: number,
): Promise<{
  people: ReadingPerson[];
  requirements: FullRequirement[];
}> {
  const detail = (await readingPeopleOf(db, [{ nodeId, version }])).get(nodeId);
  const core = detail?.people ?? [];
  const names = new Map(
    (
      await db.membership.findMany({
        where: { id: { in: core.map((person) => person.membershipId) } },
        select: { id: true, user: { select: { name: true } } },
      })
    ).map((member) => [member.id, member.user.name]),
  );
  const people = core.map((person): ReadingPerson => ({
    ...person,
    name: names.get(person.membershipId) ?? "",
  }));
  people.sort(
    (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.name.localeCompare(b.name, "es"),
  );
  return { people, requirements: detail?.requirements ?? [] };
}

export async function readingsOverview(
  ctx: AdminContext,
  nodeId: string,
  query: ReadingsQuery,
): Promise<ReadingsOverview> {
  const { version } = await publishedDocument(ctx, nodeId);
  readingScope(ctx);
  if (version === null) {
    return {
      version: null,
      requirements: [],
      summary: { total: 0, read: 0, pending: 0, overdue: 0, noAccess: 0 },
      people: pageOf([], 0, query),
    };
  }
  const { people, requirements } = await allPeople(ctx.db, nodeId, version);
  const names = new Map(
    (await ctx.db.department.findMany({ select: { id: true, name: true } })).map((d) => [
      d.id,
      d.name,
    ]),
  );
  const personNames = new Map(
    (
      await ctx.db.membership.findMany({
        where: {
          id: {
            in: requirements.flatMap((r) => (r.membershipId === null ? [] : [r.membershipId])),
          },
        },
        select: { id: true, user: { select: { name: true } } },
      })
    ).map((member) => [member.id, member.user.name]),
  );
  const filtered =
    query.status === undefined ? people : people.filter((person) => person.status === query.status);
  const { skip, take } = offsetArgs(query);
  return {
    version,
    requirements: requirements.flatMap((r) => {
      const subject =
        r.departmentId !== null
          ? {
              type: "department" as const,
              id: r.departmentId,
              name: names.get(r.departmentId) ?? "",
            }
          : r.membershipId !== null
            ? {
                type: "person" as const,
                id: r.membershipId,
                name: personNames.get(r.membershipId) ?? "",
              }
            : null;
      return subject === null
        ? []
        : [{ id: r.id, subject, includeSubareas: r.includeSubareas, dueAt: r.dueAt }];
    }),
    summary: summarize(people),
    people: pageOf(filtered.slice(skip, skip + take), filtered.length, query),
  };
}

// ─── Quiénes deben leer y no ven el documento ────────────────────────────────────────────

/** Hasta cuántos nombres se listan en el aviso (el total se informa aparte). */
const MAX_GAP_NAMES = 50;

export interface AccessGaps {
  total: number;
  people: { membershipId: string; name: string }[];
  /** Quien pide puede darles acceso (gestiona los accesos del documento). */
  canGrant: boolean;
}

/** Las personas que alcanza un requisito (real o a punto de crearse) y no ven el documento. */
export async function readingAccessGaps(
  ctx: AdminContext,
  nodeId: string,
  query: AccessGapsQuery,
): Promise<AccessGaps> {
  const { version } = await publishedDocument(ctx, nodeId);
  readingScope(ctx);
  const level = await levelOfNode(ctx, nodeId);
  const canGrant = atLeast(level, "MANAGE");
  if (version === null) return { total: 0, people: [], canGrant };
  if ((query.departmentId === undefined) === (query.membershipId === undefined)) {
    // Sin sujeto: los requisitos que ya hay.
    const { required } = await currentReadings(ctx.db, nodeId, version);
    return { ...(await gapsOf(ctx, nodeId, [...required.keys()])), canGrant };
  }
  const required = await expandRequirements(ctx.db, [
    {
      id: "",
      version,
      departmentId: query.departmentId ?? null,
      membershipId: query.membershipId ?? null,
      includeSubareas: query.includeSubareas === "true",
      dueAt: null,
    },
  ]);
  return { ...(await gapsOf(ctx, nodeId, [...required.keys()])), canGrant };
}

async function gapsOf(
  ctx: AdminContext,
  nodeId: string,
  membershipIds: readonly string[],
): Promise<Omit<AccessGaps, "canGrant">> {
  const visible = await whoCanSee(ctx.db, nodeId, membershipIds);
  const blind = membershipIds.filter((id) => !visible.has(id));
  if (blind.length === 0) return { total: 0, people: [] };
  const rows = await ctx.db.membership.findMany({
    where: { id: { in: blind } },
    select: { id: true, user: { select: { name: true } } },
  });
  const people = rows
    .map((row) => ({ membershipId: row.id, name: row.user.name }))
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
  return { total: people.length, people: people.slice(0, MAX_GAP_NAMES) };
}

/**
 * Les da acceso de lectura (Ver) al documento con el mismo alcance de la lectura: al departamento
 * (con sus subáreas si la lectura las incluye) o a la persona. Solo quien gestiona los accesos del
 * documento; no baja a quien ya tiene un nivel mayor. Cada acceso queda en la auditoría.
 */
export async function grantReadingAccess(
  ctx: AdminContext,
  deps: SharingDeps,
  nodeId: string,
  input: GrantReadingAccessInput,
): Promise<void> {
  const { version } = await publishedDocument(ctx, nodeId);
  readingScope(ctx);
  requireLevel(await levelOfNode(ctx, nodeId), "MANAGE");
  if (version === null) {
    throw new AppError("CONFLICT", { message: contentMessages.nothingPublished });
  }
  let subjects: { departmentId: string | null; membershipId: string | null; sub: boolean }[];
  if (input.requirementId !== undefined) {
    const row = await ctx.db.readRequirement.findFirst({
      where: { id: input.requirementId, nodeId },
    });
    if (row === null) throw notFound();
    subjects = [
      { departmentId: row.departmentId, membershipId: row.membershipId, sub: row.includeSubareas },
    ];
  } else if (input.departmentId !== undefined || input.membershipId !== undefined) {
    if ((input.departmentId === undefined) === (input.membershipId === undefined)) {
      throw new AppError("BAD_REQUEST", { message: contentMessages.subjectRequired });
    }
    subjects = [
      {
        departmentId: input.departmentId ?? null,
        membershipId: input.membershipId ?? null,
        sub: input.includeSubareas === true,
      },
    ];
  } else {
    const rows = await ctx.db.readRequirement.findMany({ where: { nodeId, version } });
    subjects = rows.map((r) => ({
      departmentId: r.departmentId,
      membershipId: r.membershipId,
      sub: r.includeSubareas,
    }));
  }
  for (const subject of subjects) {
    // Solo si de ese alcance hay alguien sin acceso.
    const required = await expandRequirements(ctx.db, [
      {
        id: "",
        version,
        departmentId: subject.departmentId,
        membershipId: subject.membershipId,
        includeSubareas: subject.sub,
        dueAt: null,
      },
    ]);
    const visible = await whoCanSee(ctx.db, nodeId, [...required.keys()]);
    if ([...required.keys()].every((id) => visible.has(id))) continue;
    const existing = await ctx.db.permission.findFirst({
      where: {
        nodeId,
        ...(subject.departmentId === null
          ? { membershipId: subject.membershipId ?? "" }
          : { departmentId: subject.departmentId }),
      },
      select: { level: true, expiresAt: true },
    });
    // Un acceso mayor (y vigente) no se baja a Ver.
    const keeps =
      existing !== null &&
      (existing.expiresAt === null || existing.expiresAt > new Date()) &&
      existing.level !== "VIEW";
    await setPermission(
      ctx,
      deps,
      { type: "node", id: nodeId },
      {
        level: keeps ? existing.level : "VIEW",
        ...(subject.departmentId === null
          ? { membershipId: subject.membershipId ?? "" }
          : { departmentId: subject.departmentId, includeSubareas: subject.sub }),
      },
    );
  }
}

// ─── Recordatorio manual ─────────────────────────────────────────────────────────────────

/** Avisa de nuevo a quienes les falta leer (y ven el documento). Una vez por persona y por día. */
export async function remindReaders(
  ctx: AdminContext,
  deps: ApprovalDeps,
  nodeId: string,
  input: RemindInput,
): Promise<{ sent: number }> {
  const { controlled, version } = await publishedDocument(ctx, nodeId);
  readingScope(ctx);
  if (version === null) {
    throw new AppError("CONFLICT", { message: contentMessages.nothingPublished });
  }
  const { people } = await allPeople(ctx.db, nodeId, version);
  const wanted = input.membershipIds === undefined ? null : new Set(input.membershipIds);
  const targets = people.filter(
    (person) =>
      (person.status === "pending" || person.status === "overdue") &&
      (wanted === null || wanted.has(person.membershipId)),
  );
  const key = `rem-manual:${nodeId}:${String(version)}:${new Date().toISOString().slice(0, 10)}`;
  const already = new Set(
    (
      await ctx.db.notification.findMany({
        where: { dedupeKey: key, membershipId: { in: targets.map((p) => p.membershipId) } },
        select: { membershipId: true },
      })
    ).map((row) => row.membershipId),
  );
  const recipients = targets
    .map((person) => person.membershipId)
    .filter((id) => !already.has(id) && id !== ctx.tenant.membershipId);
  // Un aviso por persona con su propio plazo: el job usa dedupeKey único por persona.
  for (const id of recipients) {
    const person = targets.find((p) => p.membershipId === id);
    await createDocumentNotices(ctx.db, deps.jobs, {
      kind: "reading_reminder",
      actorId: ctx.tenant.membershipId,
      recipients: [id],
      nodeId,
      version,
      dueAt: person?.dueAt ?? null,
      dedupeKey: key,
    });
  }
  await auditAdmin(ctx, {
    action: "document.reading.remind",
    entityType: "Node",
    entityId: nodeId,
    metadata: { code: controlled.code, version, sent: recipients.length },
  });
  return { sent: recipients.length };
}

/** El cumplimiento de un documento como CSV; queda en la auditoría. */
export async function readingsCsv(
  ctx: AdminContext,
  nodeId: string,
): Promise<{ fileName: string; csv: string }> {
  const { controlled, version } = await publishedDocument(ctx, nodeId);
  readingScope(ctx);
  const { people } = version === null ? { people: [] } : await allPeople(ctx.db, nodeId, version);
  await auditAdmin(ctx, {
    action: "document.reading.export",
    entityType: "Node",
    entityId: nodeId,
    metadata: { code: controlled.code, rows: people.length },
  });
  return {
    fileName: readingExportLabels.fileName(controlled.code),
    csv: toCsv(
      readingExportLabels.headers,
      people.map((p) => [p.name, readingExportLabels.statuses[p.status], p.readAt, p.dueAt]),
    ),
  };
}

// ─── Mis lecturas pendientes ─────────────────────────────────────────────────────────────

export interface MyReading {
  node: { id: string; name: string; type: NodeType; spaceId: string; spaceName: string };
  code: string;
  version: number;
  dueAt: Date | null;
  overdue: boolean;
}

/** Las lecturas que me faltan (de la versión vigente de cada documento que debo leer y veo). */
export async function myReadings(
  ctx: AdminContext,
  query: MyReadingsQuery,
): Promise<Page<MyReading>> {
  const actor = accessActorOf(ctx);
  const me = ctx.tenant.membershipId;
  const requirements = await ctx.db.readRequirement.findMany({
    where: {
      OR: [
        { membershipId: me },
        { departmentId: { in: [...actor.ownDepartmentIds] } },
        // «Incluye subáreas»: alcanza a quien está en un subdepartamento.
        { departmentId: { in: [...actor.departmentIds] }, includeSubareas: true },
      ],
    },
    take: 1000,
    select: { nodeId: true, version: true, dueAt: true },
  });
  if (requirements.length === 0) return pageOf([], 0, query);
  const nodeIds = [...new Set(requirements.map((r) => r.nodeId))];
  const [documents, acks, nodes, access] = await Promise.all([
    ctx.db.controlledDocument.findMany({
      where: { nodeId: { in: nodeIds }, publishedVersion: { not: null } },
      select: { nodeId: true, code: true, publishedVersion: true },
    }),
    ctx.db.readAcknowledgment.findMany({
      where: { membershipId: me, nodeId: { in: nodeIds } },
      select: { nodeId: true, version: true },
    }),
    ctx.db.node.findMany({
      where: { id: { in: nodeIds }, trashedAt: null },
      select: {
        id: true,
        name: true,
        type: true,
        spaceId: true,
        space: { select: { name: true } },
      },
    }),
    accessFor(ctx, { nodeIds }),
  ]);
  const published = new Map(documents.map((d) => [d.nodeId, d]));
  const done = new Set(acks.map((a) => `${a.nodeId}:${String(a.version)}`));
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const now = new Date();
  const items = new Map<string, MyReading>();
  for (const requirement of requirements) {
    const document = published.get(requirement.nodeId);
    const node = nodeById.get(requirement.nodeId);
    if (
      document === undefined ||
      node === undefined ||
      document.publishedVersion !== requirement.version ||
      done.has(`${requirement.nodeId}:${String(requirement.version)}`) ||
      !atLeast(access.ofNode(node.id), "VIEW")
    ) {
      continue;
    }
    const current = items.get(node.id);
    const dueAt = requirement.dueAt;
    // Si varios requisitos lo alcanzan, vale el plazo más cercano.
    if (
      current === undefined ||
      (dueAt !== null && (current.dueAt === null || dueAt < current.dueAt))
    ) {
      items.set(node.id, {
        node: {
          id: node.id,
          name: node.name,
          type: node.type,
          spaceId: node.spaceId,
          spaceName: node.space.name,
        },
        code: document.code,
        version: requirement.version,
        dueAt,
        overdue: dueAt !== null && dueAt < now,
      });
    }
  }
  const list = [...items.values()].sort(
    (a, b) =>
      Number(b.overdue) - Number(a.overdue) ||
      (a.dueAt?.getTime() ?? Infinity) - (b.dueAt?.getTime() ?? Infinity) ||
      a.node.name.localeCompare(b.node.name, "es"),
  );
  const { skip, take } = offsetArgs(query);
  return pageOf(list.slice(skip, skip + take), list.length, query);
}

/**
 * Al publicar una versión nueva, los requisitos de la anterior pasan a ella (hay que volver a leer),
 * con un plazo corto desde la publicación. Devuelve a quiénes avisar.
 */
export async function carryOverRequirements(
  tx: TenantDb,
  ctx: AdminContext,
  nodeId: string,
  fromVersion: number | null,
  toVersion: number,
  now: Date,
  renew = true,
): Promise<{ recipients: string[]; dueAt: Date }> {
  const dueAt = new Date(now.getTime() + CARRY_OVER_DAYS * 24 * 60 * 60 * 1000);
  if (fromVersion === null) return { recipients: [], dueAt };
  const previous = await tx.readRequirement.findMany({ where: { nodeId, version: fromVersion } });
  if (previous.length === 0) return { recipients: [], dueAt };
  const carried = previous.map((r) => ({
    nodeId,
    version: toVersion,
    departmentId: r.departmentId,
    membershipId: r.membershipId,
    includeSubareas: r.includeSubareas,
    // Sin nueva lectura (cambio menor) el plazo original se conserva.
    dueAt: renew ? (r.dueAt === null ? null : dueAt) : r.dueAt,
    createdById: ctx.tenant.membershipId,
  }));
  await tx.readRequirement.createMany({ data: carried });
  if (!renew) {
    // Cambio menor: quien ya leyó la anterior no tiene que volver a hacerlo.
    const done = await tx.readAcknowledgment.findMany({
      where: { nodeId, version: fromVersion },
      select: { membershipId: true, readAt: true },
    });
    if (done.length > 0) {
      await tx.readAcknowledgment.createMany({
        data: done.map((ack) => ({
          nodeId,
          version: toVersion,
          membershipId: ack.membershipId,
          readAt: ack.readAt,
        })),
        skipDuplicates: true,
      });
    }
    return { recipients: [], dueAt };
  }
  const required = await expandRequirements(
    tx,
    carried.map((r) => ({ ...r, id: "" })),
  );
  return { recipients: [...required.keys()], dueAt };
}
