// Auditoría de accesos para administradores (docs/spec/panel-admin.md): matriz departamento ×
// espacio, «¿quién puede ver esto?», «¿qué puede ver esta persona?», reportes y CSV. Todo sale del
// mismo motor que decide el acceso. Los espacios confidenciales solo los ve el propietario: ahí ni
// los administradores entran, y tampoco ven quién más lo hace.
import { contentMessages, accessExportLabels } from "../../i18n/index.ts";
import type { AccessLevel, NodeType, Prisma } from "../../generated/prisma/client.ts";
import { toCsv } from "../../lib/csv.ts";
import { notFound } from "../../lib/errors.ts";
import { offsetArgs, pageOf, type Page } from "../../lib/pagination.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { withAncestors, withDescendants, parentMapOf } from "../departments/department-tree.ts";
import {
  computeAccess,
  expiryFilter,
  loadAccessGraph,
  type AccessActor,
  type AccessReason,
} from "./access.ts";
import { loadPersonActors, MAX_EXPLAINED_PEOPLE } from "./access-actors.ts";
import type {
  FindTargetQuery,
  MatrixCellQuery,
  MatrixQuery,
  PersonQuery,
  ReportKind,
  ReportQuery,
  WhoQuery,
} from "./access-audit.schemas.ts";
import type { ExplainQuery } from "./access-explain.schemas.ts";
import {
  explainNodeAccess,
  explainSpaceAccess,
  type AccessExplanationView,
} from "./access-explain.service.ts";

/** Hasta cuántos espacios se miran para explicar a una persona. */
const MAX_SCANNED_SPACES = 2000;
/** Columnas de la matriz por página. */
const MATRIX_SPACES_PER_PAGE = 10;
/** Filas que entran en un CSV. */
const MAX_CSV_ROWS = 10_000;
const EXPIRING_DAYS = 30;

const isOwner = (ctx: AdminContext): boolean => ctx.tenant.role.base === "OWNER";

/** Filtro de espacios que quien audita puede ver (sin los confidenciales, salvo el propietario). */
const visibleSpaces = (ctx: AdminContext): Prisma.SpaceWhereInput =>
  isOwner(ctx) ? {} : { isConfidential: false };

// ─── Matriz ──────────────────────────────────────────────────────────────────────────────

export interface MatrixView {
  /** En orden de jerarquía: cada subárea debajo de su departamento, con su profundidad. */
  departments: Page<{ id: string; name: string; parentId: string | null; depth: number }>;
  spaces: Page<{ id: string; name: string; isPrivate: boolean; isConfidential: boolean }>;
  /** Una celda por departamento y espacio con acceso (las que faltan: sin acceso). */
  cells: {
    departmentId: string;
    spaceId: string;
    /** Nivel de un miembro del departamento (null: los miembros no entran). */
    level: AccessLevel | null;
    reason: AccessReason | null;
    /** Nivel de quien jefa el departamento (null: tampoco). */
    leaderLevel: AccessLevel | null;
  }[];
  /** Sin acceso al espacio entero, pero con carpetas o archivos compartidos adentro. */
  partials: { departmentId: string; spaceId: string; count: number }[];
}

/** Quien jefa el departamento: además de ser parte de él, lidera su área y sus subáreas. */
function leaderActor(departmentId: string, tree: ReadonlyMap<string, string | null>): AccessActor {
  return {
    ...departmentActor(departmentId, tree),
    membershipId: `leader:${departmentId}`,
    ledScope: new Map(
      withDescendants([departmentId], tree).map((id) => [
        id,
        { departmentId, rank: "HEAD" as const },
      ]),
    ),
  };
}

/** El departamento como una persona cualquiera que es parte de él (no jefe). */
function departmentActor(
  departmentId: string,
  tree: ReadonlyMap<string, string | null>,
): AccessActor {
  return {
    membershipId: `department:${departmentId}`,
    base: "MEMBER",
    seatType: "FULL",
    bypass: false,
    departmentIds: new Set(withAncestors([departmentId], tree)),
    ownDepartmentIds: new Set([departmentId]),
    ledScope: new Map(),
  };
}

/** Departamentos en orden de jerarquía (cada subárea debajo de su padre), con su profundidad. */
function inHierarchy(
  all: readonly { id: string; name: string; parentId: string | null }[],
): { id: string; name: string; parentId: string | null; depth: number }[] {
  const children = new Map<string | null, typeof all>();
  const ids = new Set(all.map((d) => d.id));
  for (const department of all) {
    // Un padre que no existe (no debería pasar) deja al departamento en la raíz.
    const key =
      department.parentId !== null && ids.has(department.parentId) ? department.parentId : null;
    children.set(key, [...(children.get(key) ?? []), department]);
  }
  const ordered: { id: string; name: string; parentId: string | null; depth: number }[] = [];
  const visit = (parent: string | null, depth: number) => {
    const level = [...(children.get(parent) ?? [])].sort(
      (x, y) => x.name.localeCompare(y.name, "es") || x.id.localeCompare(y.id),
    );
    for (const department of level) {
      ordered.push({ ...department, depth });
      if (depth < 50) visit(department.id, depth + 1);
    }
  };
  visit(null, 0);
  return ordered;
}

/** Tope de accesos a carpetas y archivos que se miran para marcar «parcial» en una página. */
const MAX_PARTIAL_GRANTS = 5000;

export async function accessMatrix(ctx: AdminContext, query: MatrixQuery): Promise<MatrixView> {
  const spaceWhere: Prisma.SpaceWhereInput = { archivedAt: null, ...visibleSpaces(ctx) };
  const spaceQuery = { page: 1, pageSize: MATRIX_SPACES_PER_PAGE, cursor: query.spaceCursor };
  const [spaces, spaceTotal, allDepartments] = await Promise.all([
    ctx.db.space.findMany({
      where: spaceWhere,
      orderBy: [{ name: "asc" }, { id: "asc" }],
      ...offsetArgs(spaceQuery),
      select: { id: true, name: true, isPrivate: true, isConfidential: true },
    }),
    ctx.db.space.count({ where: spaceWhere }),
    ctx.db.department.findMany({ select: { id: true, name: true, parentId: true } }),
  ]);
  const needle = query.q === undefined ? "" : query.q.toLowerCase();
  const ordered = inHierarchy(allDepartments).filter(
    (d) => needle === "" || d.name.toLowerCase().includes(needle),
  );
  const { skip, take } = offsetArgs(query);
  const departments = ordered.slice(skip, skip + take);
  const tree = parentMapOf(allDepartments);
  const spaceIds = spaces.map((s) => s.id);
  const [graph, nodeGrants] = await Promise.all([
    loadAccessGraph(ctx.db, { spaceIds }),
    ctx.db.permission.findMany({
      where: {
        nodeId: { not: null },
        departmentId: { not: null },
        node: { spaceId: { in: spaceIds }, trashedAt: null },
        AND: [expiryFilter(new Date())],
      },
      take: MAX_PARTIAL_GRANTS,
      select: {
        nodeId: true,
        departmentId: true,
        includeSubareas: true,
        node: { select: { spaceId: true } },
      },
    }),
  ]);
  const cells: MatrixView["cells"] = [];
  const partials: MatrixView["partials"] = [];
  for (const department of departments) {
    const resolver = computeAccess(departmentActor(department.id, tree), graph);
    const leader = computeAccess(leaderActor(department.id, tree), graph);
    const reach = new Set(withAncestors([department.id], tree));
    for (const space of spaces) {
      const level = resolver.ofSpace(space.id);
      const reason = resolver.reasonOfSpace(space.id);
      const leaderLevel = leader.ofSpace(space.id);
      if (level !== null || leaderLevel !== null) {
        cells.push({ departmentId: department.id, spaceId: space.id, level, reason, leaderLevel });
        continue;
      }
      const nodes = new Set(
        nodeGrants.flatMap((grant) =>
          grant.node?.spaceId === space.id &&
          grant.nodeId !== null &&
          grant.departmentId !== null &&
          (grant.departmentId === department.id ||
            (grant.includeSubareas && reach.has(grant.departmentId)))
            ? [grant.nodeId]
            : [],
        ),
      );
      if (nodes.size > 0) {
        partials.push({ departmentId: department.id, spaceId: space.id, count: nodes.size });
      }
    }
  }
  return {
    departments: pageOf(departments, ordered.length, query),
    spaces: pageOf(spaces, spaceTotal, spaceQuery),
    cells,
    partials,
  };
}

export interface MatrixCellDetail {
  department: { id: string; name: string };
  space: { id: string; name: string };
  /** Cómo llega el departamento al espacio entero (null: no llega). */
  spaceAccess: {
    level: AccessLevel;
    reasons: { level: AccessLevel; reason: AccessReason; departmentName: string | null }[];
  } | null;
  /** Las carpetas, páginas y archivos de ese espacio compartidos con el departamento. */
  items: Page<{
    id: string;
    node: { id: string; name: string; type: NodeType };
    level: AccessLevel;
    /** A qué departamento se dio: el mismo o uno de arriba (con sus subáreas). */
    via: { departmentId: string; departmentName: string; inherited: boolean };
    sharedBy: string | null;
    sharedAt: Date;
    expiresAt: Date | null;
  }>;
}

/** El detalle de una celda: por qué el departamento ve el espacio y qué se le compartió adentro. */
export async function matrixCell(
  ctx: AdminContext,
  query: MatrixCellQuery,
): Promise<MatrixCellDetail> {
  const [space, department, allDepartments] = await Promise.all([
    ctx.db.space.findFirst({
      where: { id: query.spaceId, ...visibleSpaces(ctx) },
      select: { id: true, name: true },
    }),
    ctx.db.department.findFirst({
      where: { id: query.departmentId },
      select: { id: true, name: true },
    }),
    ctx.db.department.findMany({ select: { id: true, name: true, parentId: true } }),
  ]);
  if (space === null || department === null) throw notFound();
  const tree = parentMapOf(allDepartments);
  const graph = await loadAccessGraph(ctx.db, { spaceIds: [space.id] });
  const explanation = computeAccess(departmentActor(department.id, tree), graph).explainSpace(
    space.id,
  );
  const names = new Map(allDepartments.map((d) => [d.id, d.name]));
  const where: Prisma.PermissionWhereInput = {
    nodeId: { not: null },
    node: { spaceId: space.id, trashedAt: null },
    AND: [
      expiryFilter(new Date()),
      {
        OR: [
          { departmentId: department.id },
          {
            departmentId: { in: withAncestors([department.id], tree) },
            includeSubareas: true,
          },
        ],
      },
    ],
  };
  const [rows, total] = await Promise.all([
    ctx.db.permission.findMany({
      where,
      orderBy: [{ node: { nameKey: "asc" } }, { id: "asc" }],
      ...offsetArgs(query),
      select: {
        id: true,
        level: true,
        departmentId: true,
        createdAt: true,
        expiresAt: true,
        grantedById: true,
        node: { select: { id: true, name: true, type: true } },
      },
    }),
    ctx.db.permission.count({ where }),
  ]);
  const grantors = new Map(
    (
      await ctx.db.membership.findMany({
        where: { id: { in: [...new Set(rows.map((row) => row.grantedById))] } },
        select: { id: true, user: { select: { name: true } } },
      })
    ).map((member) => [member.id, member.user.name]),
  );
  return {
    department,
    space,
    spaceAccess:
      explanation.level === null
        ? null
        : {
            level: explanation.level,
            reasons: explanation.reasons.map((r) => {
              const id =
                "departmentId" in r.reason && typeof r.reason.departmentId === "string"
                  ? r.reason.departmentId
                  : null;
              return {
                level: r.level,
                reason: r.reason,
                departmentName: id === null ? null : (names.get(id) ?? null),
              };
            }),
          },
    items: pageOf(
      rows.flatMap((row) =>
        row.node === null || row.departmentId === null
          ? []
          : [
              {
                id: row.id,
                node: row.node,
                level: row.level,
                via: {
                  departmentId: row.departmentId,
                  departmentName: names.get(row.departmentId) ?? "",
                  inherited: row.departmentId !== department.id,
                },
                sharedBy: grantors.get(row.grantedById) ?? null,
                sharedAt: row.createdAt,
                expiresAt: row.expiresAt,
              },
            ],
      ),
      total,
      query,
    ),
  };
}

// ─── ¿Quién puede ver esto? ──────────────────────────────────────────────────────────────

export interface TargetOption {
  type: "space" | "node";
  id: string;
  name: string;
  nodeType: NodeType | null;
  spaceId: string;
  spaceName: string;
}

/** Espacios o elementos por nombre, para elegir sobre cuál preguntar. */
export async function findTargets(
  ctx: AdminContext,
  query: FindTargetQuery,
): Promise<Page<TargetOption>> {
  const name: Prisma.StringFilter | undefined =
    query.q === undefined || query.q === ""
      ? undefined
      : { contains: query.q, mode: "insensitive" };
  if (query.kind === "space") {
    const where: Prisma.SpaceWhereInput = {
      ...visibleSpaces(ctx),
      ...(name === undefined ? {} : { name }),
    };
    const [rows, total] = await Promise.all([
      ctx.db.space.findMany({
        where,
        orderBy: [{ name: query.dir }, { id: "asc" }],
        ...offsetArgs(query),
        select: { id: true, name: true },
      }),
      ctx.db.space.count({ where }),
    ]);
    return pageOf(
      rows.map((r) => ({
        type: "space" as const,
        id: r.id,
        name: r.name,
        nodeType: null,
        spaceId: r.id,
        spaceName: r.name,
      })),
      total,
      query,
    );
  }
  const where: Prisma.NodeWhereInput = {
    trashedAt: null,
    space: visibleSpaces(ctx),
    ...(name === undefined ? {} : { name }),
  };
  const [rows, total] = await Promise.all([
    ctx.db.node.findMany({
      where,
      orderBy: [{ name: query.dir }, { id: "asc" }],
      ...offsetArgs(query),
      select: {
        id: true,
        name: true,
        type: true,
        spaceId: true,
        space: { select: { name: true } },
      },
    }),
    ctx.db.node.count({ where }),
  ]);
  return pageOf(
    rows.map((r) => ({
      type: "node" as const,
      id: r.id,
      name: r.name,
      nodeType: r.type,
      spaceId: r.spaceId,
      spaceName: r.space.name,
    })),
    total,
    query,
  );
}

/** Quién puede ver un espacio o un elemento y por qué (sin pedir gestionarlo). */
export async function whoCanSee(
  ctx: AdminContext,
  query: WhoQuery,
): Promise<AccessExplanationView> {
  return query.type === "space"
    ? await explainSpaceAccess(ctx, query.id, query, { audit: true })
    : await explainNodeAccess(ctx, query.id, query, { audit: true });
}

// ─── ¿Qué puede ver esta persona? ────────────────────────────────────────────────────────

export interface PersonSpaceAccess {
  space: { id: string; name: string; isPrivate: boolean };
  level: AccessLevel;
  reasons: AccessExplanationView["people"]["items"][number]["reasons"];
}

export interface PersonAccessReport {
  person: { membershipId: string; name: string; jobTitle: string | null; role: string };
  spaces: Page<PersonSpaceAccess>;
  /** Había más espacios que el tope: la lista está recortada. */
  truncated: boolean;
}

/** Los espacios a los que llega una persona, con el nivel y los motivos (mismo motor). */
export async function whatCanSee(
  ctx: AdminContext,
  membershipId: string,
  query: PersonQuery,
): Promise<PersonAccessReport> {
  const { people } = await loadPersonActors(ctx.db, { membershipIds: [membershipId] });
  const person = people[0];
  if (person === undefined) throw notFound();
  const spaces = await ctx.db.space.findMany({
    where: {
      archivedAt: null,
      ...visibleSpaces(ctx),
      ...(query.q === undefined || query.q === ""
        ? {}
        : { name: { contains: query.q, mode: "insensitive" } }),
    },
    orderBy: [{ name: query.dir }, { id: "asc" }],
    take: MAX_SCANNED_SPACES + 1,
    select: { id: true, name: true, isPrivate: true },
  });
  const truncated = spaces.length > MAX_SCANNED_SPACES;
  const scanned = spaces.slice(0, MAX_SCANNED_SPACES);
  const graph = await loadAccessGraph(ctx.db, { spaceIds: scanned.map((s) => s.id) });
  const resolver = computeAccess(person.actor, graph);
  const withAccess = scanned.flatMap((space): PersonSpaceAccess[] => {
    const explanation = resolver.explainSpace(space.id);
    return explanation.level === null
      ? []
      : [
          {
            space,
            level: explanation.level,
            reasons: explanation.reasons.map((r) => ({
              level: r.level,
              reason: r.reason,
              departmentName: null,
              from: null,
            })),
          },
        ];
  });
  const { skip, take } = offsetArgs(query);
  const items = withAccess.slice(skip, skip + take);
  // Nombres de los departamentos de los motivos mostrados.
  const ids = [
    ...new Set(
      items.flatMap((i) =>
        i.reasons.flatMap((r) =>
          "departmentId" in r.reason && typeof r.reason.departmentId === "string"
            ? [r.reason.departmentId]
            : [],
        ),
      ),
    ),
  ];
  const names = new Map(
    (ids.length === 0
      ? []
      : await ctx.db.department.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true },
        })
    ).map((d) => [d.id, d.name]),
  );
  for (const item of items) {
    for (const r of item.reasons) {
      if ("departmentId" in r.reason && typeof r.reason.departmentId === "string") {
        r.departmentName = names.get(r.reason.departmentId) ?? null;
      }
    }
  }
  return {
    person: {
      membershipId: person.membershipId,
      name: person.name,
      jobTitle: person.jobTitle,
      role: person.role.name,
    },
    spaces: pageOf(items, withAccess.length, query),
    truncated,
  };
}

// ─── Reportes ────────────────────────────────────────────────────────────────────────────

export interface ReportRow {
  id: string;
  target: {
    type: "space" | "node";
    id: string;
    name: string;
    nodeType: NodeType | null;
    spaceId: string;
    spaceName: string;
  };
  /** Quién recibió el acceso (no aplica a «herencia cortada»). */
  subject: { type: "person" | "department" | "company"; id: string; name: string } | null;
  level: AccessLevel | null;
  expiresAt: Date | null;
  createdAt: Date;
}

const permissionSelect = {
  id: true,
  level: true,
  expiresAt: true,
  createdAt: true,
  everyone: true,
  space: { select: { id: true, name: true } },
  node: {
    select: { id: true, name: true, type: true, spaceId: true, space: { select: { name: true } } },
  },
  membership: { select: { id: true, user: { select: { name: true } } } },
  department: { select: { id: true, name: true } },
} as const;

type PermissionRow = Prisma.PermissionGetPayload<{ select: typeof permissionSelect }>;

function permissionRow(row: PermissionRow): ReportRow | null {
  const target =
    row.node !== null
      ? {
          type: "node" as const,
          id: row.node.id,
          name: row.node.name,
          nodeType: row.node.type,
          spaceId: row.node.spaceId,
          spaceName: row.node.space.name,
        }
      : row.space !== null
        ? {
            type: "space" as const,
            id: row.space.id,
            name: row.space.name,
            nodeType: null,
            spaceId: row.space.id,
            spaceName: row.space.name,
          }
        : null;
  if (target === null) return null;
  const subject = row.everyone
    ? { type: "company" as const, id: "", name: contentMessages.companyName }
    : row.membership !== null
      ? { type: "person" as const, id: row.membership.id, name: row.membership.user.name }
      : row.department !== null
        ? { type: "department" as const, id: row.department.id, name: row.department.name }
        : null;
  return {
    id: row.id,
    target,
    subject,
    level: row.level,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  };
}

function reportWhere(
  ctx: AdminContext,
  kind: Exclude<ReportKind, "cut-inheritance">,
  query: ReportQuery,
): Prisma.PermissionWhereInput {
  const now = new Date();
  const confidential: Prisma.PermissionWhereInput = isOwner(ctx)
    ? {}
    : {
        OR: [{ space: { isConfidential: false } }, { node: { space: { isConfidential: false } } }],
      };
  const byKind: Prisma.PermissionWhereInput =
    kind === "direct-people"
      ? {
          membershipId: query.membershipId === undefined ? { not: null } : query.membershipId,
        }
      : kind === "guests"
        ? { membership: { role: { base: "GUEST" } } }
        : {
            expiresAt: {
              gt: now,
              lte: new Date(now.getTime() + EXPIRING_DAYS * 24 * 60 * 60 * 1000),
            },
          };
  return { AND: [byKind, confidential] };
}

async function loadReport(
  ctx: AdminContext,
  kind: ReportKind,
  query: ReportQuery,
  paging: { skip: number; take: number },
): Promise<{ rows: ReportRow[]; total: number }> {
  if (kind === "cut-inheritance") {
    const where: Prisma.NodeWhereInput = {
      inheritAccess: false,
      trashedAt: null,
      space: visibleSpaces(ctx),
    };
    const [nodes, total] = await Promise.all([
      ctx.db.node.findMany({
        where,
        orderBy: [{ createdAt: query.dir }, { id: "asc" }],
        ...paging,
        select: {
          id: true,
          name: true,
          type: true,
          spaceId: true,
          createdAt: true,
          space: { select: { name: true } },
        },
      }),
      ctx.db.node.count({ where }),
    ]);
    return {
      total,
      rows: nodes.map((n) => ({
        id: n.id,
        target: {
          type: "node",
          id: n.id,
          name: n.name,
          nodeType: n.type,
          spaceId: n.spaceId,
          spaceName: n.space.name,
        },
        subject: null,
        level: null,
        expiresAt: null,
        createdAt: n.createdAt,
      })),
    };
  }
  const where = reportWhere(ctx, kind, query);
  const [permissions, total] = await Promise.all([
    ctx.db.permission.findMany({
      where,
      orderBy:
        kind === "expiring"
          ? [{ expiresAt: "asc" }, { id: "asc" }]
          : [{ createdAt: query.dir }, { id: "asc" }],
      ...paging,
      select: permissionSelect,
    }),
    ctx.db.permission.count({ where }),
  ]);
  return {
    total,
    rows: permissions.flatMap((p) => {
      const row = permissionRow(p);
      return row === null ? [] : [row];
    }),
  };
}

export async function accessReport(
  ctx: AdminContext,
  kind: ReportKind,
  query: ReportQuery,
): Promise<Page<ReportRow>> {
  const { rows, total } = await loadReport(ctx, kind, query, offsetArgs(query));
  return pageOf(rows, total, query);
}

const targetKindLabel = (row: ReportRow): string => {
  const kinds = accessExportLabels.targetKinds;
  return row.target.type === "space"
    ? kinds.space
    : row.target.nodeType === "FOLDER"
      ? kinds.FOLDER
      : row.target.nodeType === "PAGE"
        ? kinds.PAGE
        : kinds.FILE;
};

const levelLabel = (level: AccessLevel): string => accessExportLabels.levels[level];

/** Un reporte como CSV (hasta 10.000 filas); queda en la auditoría de la empresa. */
export async function accessReportCsv(
  ctx: AdminContext,
  kind: ReportKind,
  query: ReportQuery,
): Promise<{ fileName: string; csv: string }> {
  const { rows } = await loadReport(ctx, kind, query, { skip: 0, take: MAX_CSV_ROWS });
  await auditAdmin(ctx, {
    action: "access.report.export",
    entityType: "AccessReport",
    entityId: kind,
    metadata: { rows: rows.length },
  });
  const csv = toCsv(
    accessExportLabels.reportHeaders,
    rows.map((r) => [
      targetKindLabel(r),
      r.target.name,
      r.target.spaceName,
      r.subject?.name ?? "",
      r.subject === null ? "" : r.subject.type === "person"
          ? accessExportLabels.subjectKinds.person
          : accessExportLabels.subjectKinds.department,
      r.level === null ? "" : levelLabel(r.level),
      r.expiresAt,
      r.createdAt,
    ]),
  );
  return { fileName: `${accessExportLabels.reportTitles[kind]}.csv`, csv };
}

function reasonLabel(view: { reason: AccessReason; departmentName: string | null }): string {
  const base = accessExportLabels.reasons[view.reason.kind];
  return view.departmentName === null ? base : `${base} (${view.departmentName})`;
}

/** «Quién puede ver esto» como CSV (hasta 5.000 personas). */
export async function whoCanSeeCsv(
  ctx: AdminContext,
  query: WhoQuery,
): Promise<{ fileName: string; csv: string }> {
  const all: ExplainQuery = { ...query, page: 1, pageSize: 100, sort: "name", dir: "asc" };
  const first = await whoCanSee(ctx, { ...query, ...all });
  const people = [...first.people.items];
  let cursor = first.people.nextCursor;
  while (cursor !== null && people.length < MAX_EXPLAINED_PEOPLE) {
    const next = await whoCanSee(ctx, { ...query, ...all, cursor });
    people.push(...next.people.items);
    cursor = next.people.nextCursor;
  }
  await auditAdmin(ctx, {
    action: "access.report.export",
    entityType: first.target.type === "space" ? "Space" : "Node",
    entityId: first.target.id,
    metadata: { rows: people.length },
  });
  const csv = toCsv(
    accessExportLabels.whoHeaders,
    people.map((p) => [
      p.name,
      p.jobTitle,
      p.role,
      levelLabel(p.level),
      p.reasons.map(reasonLabel).join(" | "),
    ]),
  );
  return { fileName: accessExportLabels.whoFileName(first.target.name), csv };
}
