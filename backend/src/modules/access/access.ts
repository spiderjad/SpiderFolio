// resolveAccess (docs/spec/acceso-a-contenido.md, 8.1 y 8.2): la única función que decide qué nivel
// tiene una persona sobre un espacio o un nodo. Dos partes:
// - computeAccess: pura, sobre el grafo y los permisos ya cargados (tabla de casos en sus tests).
// - loadAccess: carga lo necesario en lote (una consulta por nivel del árbol, sin N+1).
//
// Reglas: OWNER, ADMIN y content.bypass tienen MANAGE en todo. Se juntan los permisos vigentes
// dados a la persona y a todos sus departamentos (los padres incluidos). Con inheritAccess se
// suma lo del padre y, al llegar a la raíz, lo del espacio; sin él, la herencia se corta. Un
// espacio no privado da VIEW en su raíz a todo MEMBER; GUEST solo ve lo compartido. Gana el
// nivel más alto. Lectores (plaza de lector) e invitados nunca pasan de COMMENT.
//
// Espacios de un departamento (Space.departmentId): quien lidera ese departamento o alguno de sus
// padres (jefe o subjefe) tiene MANAGE; los miembros del departamento, el nivel del espacio (EDIT
// por defecto o VIEW) y los de sus subdepartamentos solo si el espacio tiene includeSubareas; el
// resto, VIEW si no es privado y nada si lo es. Lo que sale del departamento o del cargo no pasa de
// VIEW para un lector. Cada resultado trae su motivo ("Jefe de Finanzas", "Miembro de
// Contabilidad", "Administrador") para explicarlo.
//
// Espacio confidencial (implica privado): el acceso total de ADMIN y content.bypass no rige; solo el
// OWNER entra solo, y el resto por cargo, departamento o permiso explícito.
import type { TenantDb } from "../../db/tenant.ts";
import type { AccessLevel, SeatType, SystemRole } from "../../generated/prisma/client.ts";
import type { TenantContext } from "../../middleware/tenant.ts";

export const levelRank: Record<AccessLevel, number> = { VIEW: 1, COMMENT: 2, EDIT: 3, MANAGE: 4 };

export function maxLevel(a: AccessLevel | null, b: AccessLevel | null): AccessLevel | null {
  if (a === null) return b;
  if (b === null) return a;
  return levelRank[a] >= levelRank[b] ? a : b;
}

/** Si `level` alcanza para lo que se quiere hacer. */
export function atLeast(level: AccessLevel | null, needed: AccessLevel): boolean {
  return level !== null && levelRank[level] >= levelRank[needed];
}

export interface AccessActor {
  membershipId: string;
  base: SystemRole;
  seatType: SeatType;
  /** Capacidad content.bypass. */
  bypass: boolean;
  /** Departamentos de la persona y los de sus ancestros. */
  departmentIds: ReadonlySet<string>;
  /** Solo los departamentos en los que la persona está (sin los ancestros). */
  ownDepartmentIds: ReadonlySet<string>;
  /**
   * Departamentos que alcanza por su cargo (el que lidera y todas sus subáreas) → cuál lidera y
   * con qué cargo.
   */
  ledScope: ReadonlyMap<string, { departmentId: string; rank: LeaderRank }>;
}

export type LeaderRank = "HEAD" | "DEPUTY";

/** Por qué la persona tiene ese nivel sobre un espacio (la interfaz lo escribe en palabras). */
export type AccessReason =
  | { kind: "owner" }
  | { kind: "admin" }
  | { kind: "bypass" }
  | { kind: "leader"; rank: LeaderRank; departmentId: string }
  /** `subareas`: el espacio extiende el acceso a los subdepartamentos. */
  | { kind: "member"; departmentId: string; subareas: boolean }
  /** Una concesión: a la persona o a un departamento suyo (o un padre), con su vencimiento. */
  | {
      kind: "grant";
      via?: "person" | "department" | "company";
      departmentId?: string | null;
      expiresAt?: Date | null;
    }
  | { kind: "company" }
  | { kind: "visible"; departmentId: string };

export interface AccessNode {
  id: string;
  parentId: string | null;
  spaceId: string;
  inheritAccess: boolean;
}

export interface AccessSpace {
  id: string;
  isPrivate: boolean;
  /** Confidencial: el acceso total de administradores no rige (solo el OWNER entra solo). */
  isConfidential: boolean;
  /** Espacio de un departamento (null = de la empresa). */
  departmentId: string | null;
  /** Nivel de los miembros del departamento. */
  departmentLevel: AccessLevel;
  /** Los miembros de los subdepartamentos también entran con `departmentLevel`. */
  includeSubareas: boolean;
}

export interface AccessGrant {
  nodeId: string | null;
  spaceId: string | null;
  membershipId: string | null;
  departmentId: string | null;
  /** Acceso a toda la empresa (todos los miembros activos; los invitados externos no). */
  everyone: boolean;
  level: AccessLevel;
  expiresAt: Date | null;
  /** Solo en accesos a un departamento: llega también a sus subdepartamentos. */
  includeSubareas: boolean;
}

export function accessActorOf(ctx: Pick<{ tenant: TenantContext }, "tenant">): AccessActor {
  const { tenant } = ctx;
  return {
    membershipId: tenant.membershipId,
    base: tenant.role.base,
    seatType: tenant.seatType,
    bypass: tenant.capabilities.includes("content.bypass"),
    departmentIds: new Set(tenant.departmentIds),
    ownDepartmentIds: new Set(tenant.ownDepartmentIds),
    ledScope: tenant.ledScope,
  };
}

/** OWNER, ADMIN o content.bypass: MANAGE en todo, sin mirar permisos. */
export function hasFullAccess(actor: AccessActor): boolean {
  return actor.base === "OWNER" || actor.base === "ADMIN" || actor.bypass;
}

/**
 * ¿Tiene acceso total a ese espacio? OWNER siempre; ADMIN y content.bypass, salvo en un espacio
 * confidencial. Sin el espacio a mano (undefined) se asume que no es confidencial.
 */
export function hasFullAccessIn(
  actor: AccessActor,
  space: { isConfidential: boolean } | undefined,
): boolean {
  if (actor.base === "OWNER") return true;
  return hasFullAccess(actor) && space?.isConfidential !== true;
}

/** Quien no puede pasar de COMMENT: lectores e invitados externos. */
export function isLimitedActor(actor: Pick<AccessActor, "base" | "seatType">): boolean {
  return actor.base === "GUEST" || actor.seatType === "READER";
}

export interface AccessGraph {
  nodes: ReadonlyMap<string, AccessNode>;
  spaces: ReadonlyMap<string, AccessSpace>;
  grants: readonly AccessGrant[];
}

/** Un motivo que aporta nivel, y de dónde viene (null: del propio elemento). */
export interface ExplainedReason {
  level: AccessLevel;
  reason: AccessReason;
  from: { type: "space" | "node"; id: string } | null;
}

/** Todos los motivos por los que una persona llega a un elemento; el primero es el que decide. */
export interface AccessExplanation {
  level: AccessLevel | null;
  reasons: ExplainedReason[];
}

export interface AccessResolver {
  ofNode(nodeId: string): AccessLevel | null;
  ofSpace(spaceId: string): AccessLevel | null;
  /** De dónde sale el nivel sobre el espacio (null si no tiene acceso). */
  reasonOfSpace(spaceId: string): AccessReason | null;
  /** Todos los motivos del acceso a un nodo (propios y heredados), del que más pesa al que menos. */
  explainNode(nodeId: string): AccessExplanation;
  explainSpace(spaceId: string): AccessExplanation;
}

const grantReason = (grant: AccessGrant): AccessReason => ({
  kind: "grant",
  via: grant.everyone ? "company" : grant.membershipId === null ? "department" : "person",
  departmentId: grant.departmentId,
  expiresAt: grant.expiresAt,
});

/** Calcula los niveles de una persona sobre el grafo dado. Pura y memoizada. */
export function computeAccess(
  actor: AccessActor,
  graph: AccessGraph,
  now: Date = new Date(),
): AccessResolver {
  const limited = isLimitedActor(actor);
  const cap = (level: AccessLevel | null): AccessLevel | null =>
    limited && level !== null && levelRank[level] > levelRank.COMMENT ? "COMMENT" : level;

  // Permisos vigentes que alcanzan a la persona, el más alto por objetivo.
  const byNode = new Map<string, AccessLevel>();
  const bySpace = new Map<string, AccessLevel>();
  const matchNode = new Map<string, AccessGrant[]>();
  const matchSpace = new Map<string, AccessGrant[]>();
  for (const grant of graph.grants) {
    if (grant.expiresAt !== null && grant.expiresAt <= now) continue;
    const mine =
      grant.membershipId === actor.membershipId ||
      (grant.everyone && actor.base !== "GUEST") ||
      (grant.departmentId !== null &&
        (actor.ownDepartmentIds.has(grant.departmentId) ||
          (grant.includeSubareas && actor.departmentIds.has(grant.departmentId))));
    if (!mine) continue;
    if (grant.nodeId !== null) {
      matchNode.set(grant.nodeId, [...(matchNode.get(grant.nodeId) ?? []), grant]);
      byNode.set(
        grant.nodeId,
        maxLevel(byNode.get(grant.nodeId) ?? null, grant.level) ?? grant.level,
      );
    } else if (grant.spaceId !== null) {
      matchSpace.set(grant.spaceId, [...(matchSpace.get(grant.spaceId) ?? []), grant]);
      bySpace.set(
        grant.spaceId,
        maxLevel(bySpace.get(grant.spaceId) ?? null, grant.level) ?? grant.level,
      );
    }
  }

  const fullReason: AccessReason =
    actor.base === "OWNER"
      ? { kind: "owner" }
      : actor.base === "ADMIN"
        ? { kind: "admin" }
        : { kind: "bypass" };
  // Lo que sale del departamento o del cargo, para un lector, no pasa de VIEW.
  const capDerived = (level: AccessLevel): AccessLevel =>
    limited && levelRank[level] > levelRank.VIEW ? "VIEW" : level;

  interface Resolved {
    level: AccessLevel | null;
    reason: AccessReason | null;
    /** Todo lo que aporta nivel sobre el espacio (sin recortar por plaza). */
    candidates: { level: AccessLevel; reason: AccessReason }[];
  }
  const fullIn = (space: AccessSpace | undefined): boolean => hasFullAccessIn(actor, space);
  const spaceCache = new Map<string, Resolved>();
  const resolveSpace = (spaceId: string): Resolved => {
    const space = graph.spaces.get(spaceId);
    if (fullIn(space)) {
      return {
        level: "MANAGE",
        reason: fullReason,
        candidates: [{ level: "MANAGE", reason: fullReason }],
      };
    }
    const cached = spaceCache.get(spaceId);
    if (cached !== undefined) return cached;
    const result: Resolved = { level: null, reason: null, candidates: [] };
    if (space !== undefined) {
      // Candidatos en orden de preferencia ante un empate: lo del departamento, lo dado, lo visible.
      const strong: { level: AccessLevel; reason: AccessReason }[] = [];
      const weak: { level: AccessLevel; reason: AccessReason }[] = [];
      const granted = matchSpace.get(spaceId) ?? [];
      // Los invitados externos solo ven lo compartido: nada sale del departamento. Un ADMIN solo
      // llega aquí en un espacio confidencial, donde entra como cualquier miembro.
      if (actor.base !== "GUEST") {
        const hidden = space.isPrivate || space.isConfidential;
        if (space.departmentId !== null) {
          const led = actor.ledScope.get(space.departmentId);
          const member =
            actor.ownDepartmentIds.has(space.departmentId) ||
            (space.includeSubareas && actor.departmentIds.has(space.departmentId));
          if (led !== undefined) {
            strong.push({
              level: capDerived("MANAGE"),
              reason: { kind: "leader", rank: led.rank, departmentId: led.departmentId },
            });
          } else if (member) {
            strong.push({
              level: capDerived(space.departmentLevel),
              reason: {
                kind: "member",
                departmentId: space.departmentId,
                subareas: space.includeSubareas,
              },
            });
          } else if (!hidden) {
            weak.push({
              level: "VIEW",
              reason: { kind: "visible", departmentId: space.departmentId },
            });
          }
        } else if (!hidden) {
          weak.push({ level: "VIEW", reason: { kind: "company" } });
        }
      }
      const candidates = [
        ...strong,
        ...granted.map((grant) => ({ level: grant.level, reason: grantReason(grant) })),
        ...weak,
      ];
      result.candidates = candidates;
      for (const candidate of candidates) {
        const level = cap(candidate.level);
        if (
          level !== null &&
          (result.level === null || levelRank[level] > levelRank[result.level])
        ) {
          result.level = level;
          result.reason = candidate.reason;
        }
      }
    }
    spaceCache.set(spaceId, result);
    return result;
  };
  const ofSpace = (spaceId: string): AccessLevel | null => resolveSpace(spaceId).level;

  const nodeCache = new Map<string, AccessLevel | null>();
  const ofNode = (nodeId: string, depth = 0): AccessLevel | null => {
    const node = graph.nodes.get(nodeId);
    // Un nodo desconocido (ya borrado) conserva el MANAGE del acceso total: el 404 lo da la consulta.
    if (
      hasFullAccess(actor) &&
      fullIn(node === undefined ? undefined : graph.spaces.get(node.spaceId))
    )
      return "MANAGE";
    if (nodeCache.has(nodeId)) return nodeCache.get(nodeId) ?? null;
    let level: AccessLevel | null = null;
    // El tope de profundidad evita un bucle si la base tuviera un ciclo (no debería).
    if (node !== undefined && depth < 200) {
      const own = byNode.get(nodeId) ?? null;
      let inherited: AccessLevel | null = null;
      if (node.inheritAccess) {
        inherited =
          node.parentId === null
            ? ofSpace(node.spaceId)
            : graph.nodes.has(node.parentId)
              ? ofNode(node.parentId, depth + 1)
              : null;
      }
      level = cap(maxLevel(own, inherited));
    }
    nodeCache.set(nodeId, level);
    return level;
  };

  const finish = (reasons: ExplainedReason[]): AccessExplanation => {
    const sorted = reasons
      .map((entry) => ({ ...entry, level: cap(entry.level) ?? entry.level }))
      .sort((a, b) => levelRank[b.level] - levelRank[a.level]);
    return { level: sorted[0]?.level ?? null, reasons: sorted };
  };
  const explainSpace = (spaceId: string): AccessExplanation =>
    finish(resolveSpace(spaceId).candidates.map((c) => ({ ...c, from: null })));

  const explainCache = new Map<string, AccessExplanation>();
  const explainNode = (nodeId: string, depth = 0): AccessExplanation => {
    const node = graph.nodes.get(nodeId);
    if (
      hasFullAccess(actor) &&
      fullIn(node === undefined ? undefined : graph.spaces.get(node.spaceId))
    ) {
      return { level: "MANAGE", reasons: [{ level: "MANAGE", reason: fullReason, from: null }] };
    }
    const cached = explainCache.get(nodeId);
    if (cached !== undefined) return cached;
    if (node === undefined || depth >= 200) return { level: null, reasons: [] };
    const own: ExplainedReason[] = (matchNode.get(nodeId) ?? []).map((grant) => ({
      level: grant.level,
      reason: grantReason(grant),
      from: null,
    }));
    let inherited: ExplainedReason[] = [];
    if (node.inheritAccess) {
      const origin =
        node.parentId === null
          ? ({ type: "space", id: node.spaceId } as const)
          : ({ type: "node", id: node.parentId } as const);
      const up =
        node.parentId === null
          ? explainSpace(node.spaceId)
          : graph.nodes.has(node.parentId)
            ? explainNode(node.parentId, depth + 1)
            : { level: null, reasons: [] };
      inherited = up.reasons.map((entry) => ({ ...entry, from: entry.from ?? origin }));
    }
    const result = finish([...own, ...inherited]);
    explainCache.set(nodeId, result);
    return result;
  };

  return {
    ofNode: (id) => ofNode(id),
    ofSpace,
    reasonOfSpace: (id) => resolveSpace(id).reason,
    explainNode: (id) => explainNode(id),
    explainSpace,
  };
}

// ─── Carga en lote ───────────────────────────────────────────────────────────────────────

const MAX_DEPTH = 64;

type AccessDb = Pick<TenantDb, "node" | "space" | "permission">;

/**
 * Carga lo necesario para resolver `nodeIds` y `spaceIds`: los nodos con todos sus ancestros (una
 * consulta por nivel), sus espacios y los permisos que alcanzan a la persona. Quien tiene acceso
 * total no necesita nada de la base.
 */
export async function loadAccess(
  db: AccessDb,
  actor: AccessActor,
  target: { nodeIds?: readonly string[]; spaceIds?: readonly string[] },
  now: Date = new Date(),
): Promise<AccessResolver> {
  // Solo el OWNER puede saltarse la base: a ADMIN y bypass hay que mirarles los espacios confidenciales.
  if (actor.base === "OWNER")
    return computeAccess(actor, { nodes: new Map(), spaces: new Map(), grants: [] }, now);
  return computeAccess(actor, await loadGraph(db, target, now, subjectFilter(actor)), now);
}

/**
 * El grafo de esos nodos y espacios con TODAS las concesiones vigentes (no solo las de una
 * persona): sirve para resolver y explicar el acceso de muchas personas con una sola carga.
 */
export async function loadAccessGraph(
  db: AccessDb,
  target: { nodeIds?: readonly string[]; spaceIds?: readonly string[] },
  now: Date = new Date(),
): Promise<AccessGraph> {
  return await loadGraph(db, target, now, null);
}

async function loadGraph(
  db: AccessDb,
  target: { nodeIds?: readonly string[]; spaceIds?: readonly string[] },
  now: Date,
  subject: ReturnType<typeof subjectFilter> | null,
): Promise<AccessGraph> {
  const nodes = new Map<string, AccessNode>();
  let pending = [...new Set(target.nodeIds ?? [])];
  for (let depth = 0; pending.length > 0 && depth < MAX_DEPTH; depth++) {
    const rows = await db.node.findMany({
      where: { id: { in: pending } },
      select: { id: true, parentId: true, spaceId: true, inheritAccess: true },
    });
    for (const row of rows) nodes.set(row.id, row);
    pending = [
      ...new Set(
        rows.flatMap((row) =>
          row.parentId !== null && !nodes.has(row.parentId) ? [row.parentId] : [],
        ),
      ),
    ];
  }

  const spaceIds = [
    ...new Set([...(target.spaceIds ?? []), ...[...nodes.values()].map((node) => node.spaceId)]),
  ];
  const [spaces, grants] = await Promise.all([
    db.space.findMany({
      where: { id: { in: spaceIds } },
      select: {
        id: true,
        isPrivate: true,
        isConfidential: true,
        departmentId: true,
        departmentLevel: true,
        includeSubareas: true,
      },
    }),
    db.permission.findMany({
      where: {
        OR: [{ nodeId: { in: [...nodes.keys()] } }, { spaceId: { in: spaceIds } }],
        AND: [...(subject === null ? [] : [subject]), expiryFilter(now)],
      },
      select: {
        nodeId: true,
        spaceId: true,
        membershipId: true,
        departmentId: true,
        everyone: true,
        level: true,
        expiresAt: true,
        includeSubareas: true,
      },
    }),
  ]);
  return { nodes, spaces: new Map(spaces.map((s) => [s.id, s])), grants };
}

/**
 * Filtro SQL de los permisos que alcanzan a la persona (ella, alguno de sus departamentos o, salvo
 * un invitado externo, toda la empresa). `company: false` los deja fuera (ej. «Compartidos conmigo»).
 */
export function subjectFilter(actor: AccessActor, { company = true }: { company?: boolean } = {}) {
  return {
    OR: [
      { membershipId: actor.membershipId },
      ...(company && actor.base !== "GUEST" ? [{ everyone: true }] : []),
      { departmentId: { in: [...actor.ownDepartmentIds] } },
      // Un acceso a un departamento padre llega a sus subáreas solo si lo incluye.
      { departmentId: { in: [...actor.departmentIds] }, includeSubareas: true },
    ],
  };
}

/** Filtro SQL de permisos vigentes. */
export function expiryFilter(now: Date) {
  return { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] };
}
