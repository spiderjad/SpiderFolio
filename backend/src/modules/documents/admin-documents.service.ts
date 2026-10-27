// /admin/documents (docs/spec/panel-admin.md): listado de documentos controlados, bandeja de
// aprobaciones, cumplimiento de lectura por documento y por departamento, y reglas de numeración por
// tipo. Quien tiene las capacidades de documentos ve toda la empresa; un jefe o subjefe, solo los
// documentos cuyo departamento responsable es de su área.
import type { DocStatus, NodeType, Prisma } from "../../generated/prisma/client.ts";
import { AppError, forbidden, notFound } from "../../lib/errors.ts";
import { contentMessages } from "../../i18n/index.ts";
import { offsetArgs, pageOf, type Page } from "../../lib/pagination.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { listDocumentTypes, type DocumentTypeView } from "./documents.service.ts";
import type {
  AdminDocumentsQuery,
  AdminPagedQuery,
  TypeInput,
  TypeUpdateInput,
} from "./documents.schemas.ts";
import { expandRequirements, whoCanSee } from "./readings.core.ts";

interface Scope {
  all: boolean;
  departments: ReadonlySet<string>;
}

/** Toda la empresa con las capacidades de documentos; un jefe, su área; el resto, nada. */
function scopeOf(ctx: AdminContext): Scope {
  const caps = ctx.actor.capabilities;
  if (caps.includes("documents.approve") || caps.includes("documents.require_reading")) {
    return { all: true, departments: new Set() };
  }
  if (ctx.tenant.ledScope.size > 0) {
    return { all: false, departments: new Set(ctx.tenant.ledScope.keys()) };
  }
  throw forbidden();
}

const scopeWhere = (scope: Scope): Prisma.ControlledDocumentWhereInput =>
  scope.all ? {} : { ownerDepartmentId: { in: [...scope.departments] } };

const nodeSelect = {
  id: true,
  name: true,
  type: true,
  spaceId: true,
  space: { select: { name: true } },
} as const;

interface NodeRef {
  id: string;
  name: string;
  type: NodeType;
  spaceId: string;
  spaceName: string;
}

const refOf = (node: {
  id: string;
  name: string;
  type: NodeType;
  spaceId: string;
  space: { name: string };
}): NodeRef => ({
  id: node.id,
  name: node.name,
  type: node.type,
  spaceId: node.spaceId,
  spaceName: node.space.name,
});

async function departmentNames(ctx: AdminContext): Promise<Map<string, string>> {
  return new Map(
    (await ctx.db.department.findMany({ select: { id: true, name: true } })).map((d) => [
      d.id,
      d.name,
    ]),
  );
}

// ─── Listado ─────────────────────────────────────────────────────────────────────────────

export interface AdminDocumentRow {
  node: NodeRef;
  code: string;
  docType: string;
  /** Estado de la versión más nueva. */
  status: DocStatus;
  publishedVersion: number | null;
  ownerDepartment: { id: string; name: string } | null;
  reviewDueAt: Date | null;
}

const DAY = 24 * 60 * 60 * 1000;

export async function listDocuments(
  ctx: AdminContext,
  query: AdminDocumentsQuery,
): Promise<Page<AdminDocumentRow>> {
  const scope = scopeOf(ctx);
  const and: Prisma.ControlledDocumentWhereInput[] = [
    scopeWhere(scope),
    { node: { trashedAt: null } },
  ];
  if (query.q !== undefined && query.q !== "") {
    and.push({
      OR: [
        { code: { contains: query.q, mode: "insensitive" } },
        { node: { name: { contains: query.q, mode: "insensitive" } } },
      ],
    });
  }
  if (query.departmentId !== undefined) and.push({ ownerDepartmentId: query.departmentId });
  if (query.review === "due") {
    and.push({ reviewDueAt: { not: null, lte: new Date(Date.now() + 30 * DAY) } });
  }
  if (query.status !== undefined) {
    // Estado de la versión más nueva de cada documento.
    const newest = await ctx.db.documentVersion.groupBy({
      by: ["nodeId"],
      _max: { version: true },
    });
    const matching = await ctx.db.documentVersion.findMany({
      where: { status: query.status },
      select: { nodeId: true, version: true },
    });
    const latest = new Map(newest.map((row) => [row.nodeId, row._max.version]));
    and.push({
      nodeId: {
        in: matching.filter((v) => latest.get(v.nodeId) === v.version).map((v) => v.nodeId),
      },
    });
  }
  const where: Prisma.ControlledDocumentWhereInput = { AND: and };
  const [rows, total, names] = await Promise.all([
    ctx.db.controlledDocument.findMany({
      where,
      orderBy: [{ code: query.dir }, { id: "asc" }],
      ...offsetArgs(query),
      select: {
        nodeId: true,
        code: true,
        docType: true,
        ownerDepartmentId: true,
        publishedVersion: true,
        reviewDueAt: true,
        node: { select: nodeSelect },
      },
    }),
    ctx.db.controlledDocument.count({ where }),
    departmentNames(ctx),
  ]);
  const versions = await ctx.db.documentVersion.findMany({
    where: { nodeId: { in: rows.map((r) => r.nodeId) } },
    orderBy: { version: "desc" },
    select: { nodeId: true, status: true },
  });
  const statusOf = new Map<string, DocStatus>();
  for (const version of versions)
    if (!statusOf.has(version.nodeId)) statusOf.set(version.nodeId, version.status);
  return pageOf(
    rows.map((row) => ({
      node: refOf(row.node),
      code: row.code,
      docType: row.docType,
      status: statusOf.get(row.nodeId) ?? "DRAFT",
      publishedVersion: row.publishedVersion,
      ownerDepartment:
        row.ownerDepartmentId === null
          ? null
          : { id: row.ownerDepartmentId, name: names.get(row.ownerDepartmentId) ?? "" },
      reviewDueAt: row.reviewDueAt,
    })),
    total,
    query,
  );
}

// ─── Bandeja de aprobaciones (de toda el área) ───────────────────────────────────────────

export interface AdminApprovalRow {
  node: NodeRef;
  code: string;
  version: number;
  submittedAt: Date;
  submittedBy: string | null;
  approvers: { name: string; decision: "APPROVED" | "CHANGES_REQUESTED" | "REJECTED" | null }[];
}

export async function pendingApprovals(
  ctx: AdminContext,
  query: AdminPagedQuery,
): Promise<Page<AdminApprovalRow>> {
  const scope = scopeOf(ctx);
  const documents = await ctx.db.controlledDocument.findMany({
    where: { AND: [scopeWhere(scope), { node: { trashedAt: null } }] },
    select: { nodeId: true, code: true },
  });
  const codeOf = new Map(documents.map((d) => [d.nodeId, d.code]));
  const versions = await ctx.db.documentVersion.findMany({
    where: { nodeId: { in: [...codeOf.keys()] }, status: "IN_REVIEW", submittedAt: { not: null } },
    orderBy: [{ submittedAt: "asc" }, { id: "asc" }],
    select: { nodeId: true, version: true, submittedAt: true, submittedById: true },
  });
  const nodeIds = versions.map((v) => v.nodeId);
  const [nodes, approvals] = await Promise.all([
    ctx.db.node.findMany({ where: { id: { in: nodeIds } }, select: nodeSelect }),
    ctx.db.approval.findMany({ where: { nodeId: { in: nodeIds } } }),
  ]);
  const people = new Map(
    (
      await ctx.db.membership.findMany({
        where: {
          id: {
            in: [
              ...new Set([
                ...approvals.map((a) => a.approverId),
                ...versions.flatMap((v) => (v.submittedById === null ? [] : [v.submittedById])),
              ]),
            ],
          },
        },
        select: { id: true, user: { select: { name: true } } },
      })
    ).map((member) => [member.id, member.user.name]),
  );
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const items = versions.flatMap((v): AdminApprovalRow[] => {
    const node = nodeById.get(v.nodeId);
    const code = codeOf.get(v.nodeId);
    if (node === undefined || code === undefined || v.submittedAt === null) return [];
    return [
      {
        node: refOf(node),
        code,
        version: v.version,
        submittedAt: v.submittedAt,
        submittedBy: v.submittedById === null ? null : (people.get(v.submittedById) ?? null),
        approvers: approvals
          .filter(
            (a) =>
              a.nodeId === v.nodeId &&
              a.version === v.version &&
              a.round.getTime() === v.submittedAt?.getTime(),
          )
          .map((a) => ({
            name: people.get(a.approverId) ?? "",
            decision:
              a.decision === "APPROVED" ||
              a.decision === "CHANGES_REQUESTED" ||
              a.decision === "REJECTED"
                ? a.decision
                : null,
          })),
      },
    ];
  });
  const { skip, take } = offsetArgs(query);
  return pageOf(items.slice(skip, skip + take), items.length, query);
}

// ─── Cumplimiento ────────────────────────────────────────────────────────────────────────

export interface ComplianceCounts {
  total: number;
  read: number;
  pending: number;
  overdue: number;
}

export interface DocumentCompliance extends ComplianceCounts {
  node: NodeRef;
  code: string;
  version: number;
}

/** Documentos con lectura pedida (de la versión vigente). Tope de documentos que se calculan. */
const MAX_COMPLIANCE_DOCS = 300;

async function documentsWithReadings(ctx: AdminContext, scope: Scope) {
  const documents = await ctx.db.controlledDocument.findMany({
    where: {
      AND: [scopeWhere(scope), { publishedVersion: { not: null } }, { node: { trashedAt: null } }],
    },
    orderBy: { code: "asc" },
    take: MAX_COMPLIANCE_DOCS,
    select: { nodeId: true, code: true, publishedVersion: true, node: { select: nodeSelect } },
  });
  const requirements = await ctx.db.readRequirement.findMany({
    where: { nodeId: { in: documents.map((d) => d.nodeId) } },
  });
  return documents.flatMap((document) => {
    const version = document.publishedVersion;
    if (version === null) return [];
    const mine = requirements.filter((r) => r.nodeId === document.nodeId && r.version === version);
    return mine.length === 0 ? [] : [{ document, version, requirements: mine }];
  });
}

/** Por persona y documento: leído, pendiente o vencido (solo a quienes ven el documento). */
async function peopleStates(
  ctx: AdminContext,
  entry: Awaited<ReturnType<typeof documentsWithReadings>>[number],
) {
  const required = await expandRequirements(ctx.db, entry.requirements);
  const [acks, visible] = await Promise.all([
    ctx.db.readAcknowledgment.findMany({
      where: { nodeId: entry.document.nodeId, version: entry.version },
      select: { membershipId: true },
    }),
    whoCanSee(ctx.db, entry.document.nodeId, [...required.keys()]),
  ]);
  const read = new Set(acks.map((a) => a.membershipId));
  const now = Date.now();
  return [...required.values()]
    .filter((person) => visible.has(person.membershipId))
    .map((person) => ({
      membershipId: person.membershipId,
      state: read.has(person.membershipId)
        ? ("read" as const)
        : person.dueAt !== null && person.dueAt.getTime() < now
          ? ("overdue" as const)
          : ("pending" as const),
    }));
}

const emptyCounts = (): ComplianceCounts => ({ total: 0, read: 0, pending: 0, overdue: 0 });

export async function complianceByDocument(
  ctx: AdminContext,
  query: AdminPagedQuery,
): Promise<Page<DocumentCompliance>> {
  const scope = scopeOf(ctx);
  const all = await documentsWithReadings(ctx, scope);
  const { skip, take } = offsetArgs(query);
  const slice = all.slice(skip, skip + take);
  const items: DocumentCompliance[] = [];
  for (const entry of slice) {
    const counts = emptyCounts();
    for (const person of await peopleStates(ctx, entry)) {
      counts.total += 1;
      counts[person.state] += 1;
    }
    items.push({
      node: refOf(entry.document.node),
      code: entry.document.code,
      version: entry.version,
      ...counts,
    });
  }
  return pageOf(items, all.length, query);
}

export interface DepartmentCompliance extends ComplianceCounts {
  department: { id: string; name: string };
}

/** Por departamento: lecturas pedidas, hechas, pendientes y vencidas de sus miembros (todos los documentos). */
export async function complianceByDepartment(
  ctx: AdminContext,
  query: AdminPagedQuery,
): Promise<Page<DepartmentCompliance>> {
  const scope = scopeOf(ctx);
  const all = await documentsWithReadings(ctx, scope);
  const membership = new Map<string, string[]>();
  const members = await ctx.db.departmentMember.findMany({
    where: { membership: { status: "ACTIVE" } },
    select: { membershipId: true, departmentId: true },
  });
  for (const member of members) {
    membership.set(member.membershipId, [
      ...(membership.get(member.membershipId) ?? []),
      member.departmentId,
    ]);
  }
  const byDepartment = new Map<string, ComplianceCounts>();
  for (const entry of all) {
    for (const person of await peopleStates(ctx, entry)) {
      for (const departmentId of membership.get(person.membershipId) ?? []) {
        if (!scope.all && !scope.departments.has(departmentId)) continue;
        const counts = byDepartment.get(departmentId) ?? emptyCounts();
        counts.total += 1;
        counts[person.state] += 1;
        byDepartment.set(departmentId, counts);
      }
    }
  }
  const names = await departmentNames(ctx);
  const rows = [...byDepartment.entries()]
    .map(([id, counts]) => ({ department: { id, name: names.get(id) ?? "" }, ...counts }))
    .sort((a, b) => a.department.name.localeCompare(b.department.name, "es"));
  const { skip, take } = offsetArgs(query);
  return pageOf(rows.slice(skip, skip + take), rows.length, query);
}

// ─── Numeración por tipo ─────────────────────────────────────────────────────────────────

export interface DocumentTypeAdmin extends DocumentTypeView {
  padding: number;
  nextNumber: number;
  /** Ejemplo del próximo código. */
  example: string;
  /** Cuántos documentos usan el tipo. */
  documents: number;
}

function requireSettings(ctx: AdminContext): void {
  if (!ctx.actor.capabilities.includes("workspace.settings")) throw forbidden();
}

const exampleOf = (type: { prefix: string; padding: number; nextNumber: number }): string =>
  `${type.prefix}-${String(type.nextNumber).padStart(type.padding, "0")}`;

export async function listTypes(ctx: AdminContext): Promise<DocumentTypeAdmin[]> {
  scopeOf(ctx);
  await listDocumentTypes(ctx);
  const [types, counts] = await Promise.all([
    ctx.db.documentType.findMany({ orderBy: [{ position: "asc" }, { code: "asc" }] }),
    ctx.db.controlledDocument.groupBy({ by: ["docType"], _count: { _all: true } }),
  ]);
  const used = new Map(counts.map((row) => [row.docType, row._count._all]));
  return types.map((type) => ({
    code: type.code,
    name: type.name,
    prefix: type.prefix,
    reviewMonths: type.reviewMonths,
    padding: type.padding,
    nextNumber: type.nextNumber,
    example: exampleOf(type),
    documents: used.get(type.code) ?? 0,
  }));
}

export async function createType(
  ctx: AdminContext,
  input: TypeInput,
): Promise<DocumentTypeAdmin[]> {
  requireSettings(ctx);
  await listDocumentTypes(ctx);
  if ((await ctx.db.documentType.count({ where: { code: input.code } })) > 0) {
    throw new AppError("CONFLICT", { message: contentMessages.typeExists });
  }
  const position = await ctx.db.documentType.count();
  await ctx.db.$transaction(async (tx) => {
    await tx.documentType.create({
      data: {
        code: input.code,
        name: input.name,
        prefix: input.prefix ?? input.code,
        padding: input.padding ?? 3,
        reviewMonths: input.reviewMonths ?? 12,
        position,
      },
    });
    await auditAdmin(
      { db: tx, info: ctx.info },
      { action: "document.type.create", entityType: "DocumentType", entityId: input.code },
    );
  });
  return await listTypes(ctx);
}

export async function updateType(
  ctx: AdminContext,
  code: string,
  input: TypeUpdateInput,
): Promise<DocumentTypeAdmin[]> {
  requireSettings(ctx);
  const type = await ctx.db.documentType.findFirst({ where: { code } });
  if (type === null) throw notFound();
  // El contador solo sube: bajarlo repetiría códigos ya usados.
  if (input.nextNumber !== undefined && input.nextNumber < type.nextNumber) {
    throw new AppError("BAD_REQUEST", { message: contentMessages.counterOnlyUp });
  }
  await ctx.db.$transaction(async (tx) => {
    await tx.documentType.update({
      where: { id: type.id },
      data: {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.prefix === undefined ? {} : { prefix: input.prefix }),
        ...(input.padding === undefined ? {} : { padding: input.padding }),
        ...(input.reviewMonths === undefined ? {} : { reviewMonths: input.reviewMonths }),
        ...(input.nextNumber === undefined ? {} : { nextNumber: input.nextNumber }),
      },
    });
    await auditAdmin(
      { db: tx, info: ctx.info },
      {
        action: "document.type.update",
        entityType: "DocumentType",
        entityId: code,
        metadata: { ...input },
      },
    );
  });
  return await listTypes(ctx);
}
