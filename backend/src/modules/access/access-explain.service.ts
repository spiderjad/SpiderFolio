// «Quién accede y por qué» (docs/spec/acceso-a-contenido.md, 8.3): para un espacio o un nodo, los
// accesos dados (aquí y heredados, con su origen) y todas las personas con acceso, con su nivel y los
// motivos. Usa el mismo motor que decide el acceso (computeAccess), así la explicación nunca
// contradice lo que cada persona puede hacer. Solo quien gestiona el elemento lo ve.
import type { AccessLevel, NodeType } from "../../generated/prisma/client.ts";
import { forbidden, notFound } from "../../lib/errors.ts";
import { contentMessages } from "../../i18n/index.ts";
import { offsetArgs, pageOf, type Page } from "../../lib/pagination.ts";
import type { AdminContext } from "../admin/admin-context.ts";
import {
  computeAccess,
  expiryFilter,
  levelRank,
  loadAccessGraph,
  type AccessExplanation,
  type AccessGraph,
  type AccessReason,
  type ExplainedReason,
} from "./access.ts";
import { canManageSpace, levelOfNode, levelOfSpace, requireLevel } from "./access-context.ts";
import { loadPersonActors } from "./access-actors.ts";
import type { ExplainQuery } from "./access-explain.schemas.ts";

type Origin = { type: "space" | "node"; id: string; name: string };

export interface ReasonView {
  level: AccessLevel;
  reason: AccessReason;
  /** Nombre del departamento al que se refiere el motivo, si lo hay. */
  departmentName: string | null;
  /** De dónde viene si es heredado; null si es del propio elemento. */
  from: Origin | null;
}

export interface GrantView {
  id: string;
  subject: { type: "person" | "department" | "company"; id: string; name: string };
  level: AccessLevel;
  expiresAt: Date | null;
  /** Solo en accesos a un departamento: llega también a sus subdepartamentos. */
  includeSubareas: boolean;
  grantedBy: string | null;
  /** null: dado en este elemento; si no, el elemento padre del que se hereda. */
  from: Origin | null;
}

export interface PersonAccessView {
  membershipId: string;
  name: string;
  jobTitle: string | null;
  role: string;
  level: AccessLevel;
  reasons: ReasonView[];
}

export interface AccessExplanationView {
  target: {
    type: "space" | "node";
    id: string;
    name: string;
    nodeType: NodeType | null;
    spaceId: string;
  };
  /** Solo en nodos: si hereda y de dónde. */
  inheritance: { inherits: boolean; from: Origin } | null;
  grants: GrantView[];
  people: Page<PersonAccessView> & {
    /** Había más personas que el tope de explicación: la lista está recortada. */
    truncated: boolean;
  };
}

/** Los nombres que hacen falta para mostrar los motivos y los orígenes. */
async function nameLookups(ctx: AdminContext, departmentIds: readonly string[]) {
  const unique = [...new Set(departmentIds)];
  const found =
    unique.length === 0
      ? []
      : await ctx.db.department.findMany({
          where: { id: { in: unique } },
          select: { id: true, name: true },
        });
  return new Map(found.map((d) => [d.id, d.name]));
}

const departmentOf = (reason: AccessReason): string | null =>
  "departmentId" in reason && typeof reason.departmentId === "string" ? reason.departmentId : null;

/**
 * Los elementos de los que este hereda, hacia arriba mientras la herencia no esté cortada:
 * el propio nodo primero y el espacio al final (si la cadena llega).
 */
function chainOf(graph: AccessGraph, nodeId: string | null, spaceId: string) {
  const chain: { type: "space" | "node"; id: string }[] = [];
  let currentId = nodeId;
  while (currentId !== null) {
    const node = graph.nodes.get(currentId);
    if (node === undefined) return chain;
    chain.push({ type: "node", id: node.id });
    if (!node.inheritAccess) return chain;
    currentId = node.parentId;
  }
  chain.push({ type: "space", id: spaceId });
  return chain;
}

async function explainTarget(
  ctx: AdminContext,
  target: { nodeId: string | null; spaceId: string },
  info: { name: string; nodeType: NodeType | null },
  query: ExplainQuery,
): Promise<AccessExplanationView> {
  const now = new Date();
  const graph = await loadAccessGraph(
    ctx.db,
    target.nodeId === null ? { spaceIds: [target.spaceId] } : { nodeIds: [target.nodeId] },
    now,
  );
  const chain = chainOf(graph, target.nodeId, target.spaceId);

  // Nombres de los elementos de la cadena (para «hereda de…» y el origen de cada acceso).
  const nodeIds = chain.filter((c) => c.type === "node").map((c) => c.id);
  const [nodes, space] = await Promise.all([
    nodeIds.length === 0
      ? []
      : ctx.db.node.findMany({ where: { id: { in: nodeIds } }, select: { id: true, name: true } }),
    ctx.db.space.findFirst({ where: { id: target.spaceId }, select: { name: true } }),
  ]);
  const names = new Map<string, string>([
    ...nodes.map((n): [string, string] => [`node:${n.id}`, n.name]),
    [`space:${target.spaceId}`, space?.name ?? ""],
  ]);
  const originOf = (c: { type: "space" | "node"; id: string }): Origin => ({
    ...c,
    name: names.get(`${c.type}:${c.id}`) ?? "",
  });

  // Accesos dados en la cadena (con su id, para poder cambiarlos o quitarlos).
  const permissions = await ctx.db.permission.findMany({
    where: {
      AND: [
        {
          OR: [
            ...(nodeIds.length === 0 ? [] : [{ nodeId: { in: nodeIds } }]),
            ...(chain.some((c) => c.type === "space") ? [{ spaceId: target.spaceId }] : []),
          ],
        },
        expiryFilter(now),
      ],
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      nodeId: true,
      spaceId: true,
      level: true,
      expiresAt: true,
      includeSubareas: true,
      everyone: true,
      grantedById: true,
      membership: { select: { id: true, user: { select: { name: true } } } },
      department: { select: { id: true, name: true } },
    },
  });
  const grantors =
    permissions.length === 0
      ? []
      : await ctx.db.membership.findMany({
          where: { id: { in: [...new Set(permissions.map((p) => p.grantedById))] } },
          select: { id: true, user: { select: { name: true } } },
        });
  const grantorName = new Map(grantors.map((m) => [m.id, m.user.name]));
  const depth = (p: { nodeId: string | null }) =>
    chain.findIndex((c) => (p.nodeId === null ? c.type === "space" : c.id === p.nodeId));
  const grants = permissions
    .flatMap((p): GrantView[] => {
      const at = depth(p);
      const subject = p.everyone
        ? { type: "company" as const, id: "", name: contentMessages.companyName }
        : p.membership !== null
          ? { type: "person" as const, id: p.membership.id, name: p.membership.user.name }
          : p.department !== null
            ? { type: "department" as const, id: p.department.id, name: p.department.name }
            : null;
      const origin = chain[at];
      if (subject === null || at < 0 || origin === undefined) return [];
      const here = target.nodeId === null ? origin.type === "space" : origin.id === target.nodeId;
      return [
        {
          id: p.id,
          subject,
          level: p.level,
          expiresAt: p.expiresAt,
          includeSubareas: p.includeSubareas,
          grantedBy: grantorName.get(p.grantedById) ?? null,
          from: here ? null : originOf(origin),
        },
      ];
    })
    .sort((a, b) => Number(a.from !== null) - Number(b.from !== null));

  // Todas las personas, resueltas con el mismo grafo.
  const { people, truncated } = await loadPersonActors(ctx.db, { q: query.q });
  const explained: { person: (typeof people)[number]; explanation: AccessExplanation }[] = [];
  for (const person of people) {
    const resolver = computeAccess(person.actor, graph, now);
    const explanation =
      target.nodeId === null
        ? resolver.explainSpace(target.spaceId)
        : resolver.explainNode(target.nodeId);
    if (explanation.level !== null) explained.push({ person, explanation });
  }
  const direction = query.dir === "desc" ? -1 : 1;
  explained.sort((a, b) => {
    const byLevel =
      query.sort === "level" && a.explanation.level !== null && b.explanation.level !== null
        ? levelRank[b.explanation.level] - levelRank[a.explanation.level]
        : 0;
    const byName = a.person.name.localeCompare(b.person.name, "es");
    return (
      direction * (byLevel !== 0 ? byLevel : byName) ||
      a.person.membershipId.localeCompare(b.person.membershipId)
    );
  });
  const { skip, take } = offsetArgs(query);
  const pageItems = explained.slice(skip, skip + take);

  // Nombres de los departamentos de los motivos de esta página.
  const departmentNames = await nameLookups(
    ctx,
    pageItems.flatMap((e) => e.explanation.reasons.flatMap((r) => departmentOf(r.reason) ?? [])),
  );
  const reasonView = (r: ExplainedReason): ReasonView => {
    const departmentId = departmentOf(r.reason);
    return {
      level: r.level,
      reason: r.reason,
      departmentName: departmentId === null ? null : (departmentNames.get(departmentId) ?? null),
      from: r.from === null ? null : originOf(r.from),
    };
  };
  const items = pageItems.map(({ person, explanation }): PersonAccessView => ({
    membershipId: person.membershipId,
    name: person.name,
    jobTitle: person.jobTitle,
    role: person.role.name,
    level: explanation.level ?? "VIEW",
    reasons: explanation.reasons.map(reasonView),
  }));

  let inheritance: AccessExplanationView["inheritance"] = null;
  if (target.nodeId !== null) {
    const node = graph.nodes.get(target.nodeId);
    if (node === undefined) throw notFound();
    const parent = node.parentId === null ? null : node.parentId;
    inheritance = {
      inherits: node.inheritAccess,
      from: originOf(
        parent === null ? { type: "space", id: node.spaceId } : { type: "node", id: parent },
      ),
    };
    // El nombre del padre puede no estar en la cadena si la herencia está cortada.
    if (parent !== null && !names.has(`node:${parent}`)) {
      const row = await ctx.db.node.findFirst({ where: { id: parent }, select: { name: true } });
      inheritance.from.name = row?.name ?? "";
    }
  }

  return {
    target: {
      type: target.nodeId === null ? "space" : "node",
      id: target.nodeId ?? target.spaceId,
      name: info.name,
      nodeType: info.nodeType,
      spaceId: target.spaceId,
    },
    inheritance,
    grants,
    people: { ...pageOf(items, explained.length, query), truncated },
  };
}

/**
 * La auditoría (capacidad permissions.audit) mira cualquier espacio, salvo los confidenciales:
 * ahí ni los administradores entran, así que solo el propietario ve quién accede.
 */
async function assertAuditable(ctx: AdminContext, spaceId: string): Promise<void> {
  const space = await ctx.db.space.findFirst({
    where: { id: spaceId },
    select: { isConfidential: true },
  });
  if (space === null || (space.isConfidential && ctx.tenant.role.base !== "OWNER")) {
    throw notFound();
  }
}

/** Quién accede a un nodo y por qué. Pide poder gestionarlo (MANAGE). */
export async function explainNodeAccess(
  ctx: AdminContext,
  nodeId: string,
  query: ExplainQuery,
  options: { audit?: boolean } = {},
): Promise<AccessExplanationView> {
  const node = await ctx.db.node.findFirst({
    where: { id: nodeId, trashedAt: null },
    select: { id: true, name: true, type: true, spaceId: true },
  });
  if (node === null) throw notFound();
  if (options.audit === true) await assertAuditable(ctx, node.spaceId);
  else requireLevel(await levelOfNode(ctx, nodeId), "MANAGE");
  return await explainTarget(
    ctx,
    { nodeId: node.id, spaceId: node.spaceId },
    { name: node.name, nodeType: node.type },
    query,
  );
}

/** Quién accede a un espacio y por qué. Pide gestionarlo (MANAGE o la capacidad spaces.manage). */
export async function explainSpaceAccess(
  ctx: AdminContext,
  spaceId: string,
  query: ExplainQuery,
  options: { audit?: boolean } = {},
): Promise<AccessExplanationView> {
  const space = await ctx.db.space.findFirst({
    where: { id: spaceId },
    select: { id: true, name: true },
  });
  if (space === null) throw notFound();
  if (options.audit === true) {
    await assertAuditable(ctx, spaceId);
  } else {
    const level = await levelOfSpace(ctx, spaceId);
    // Sin acceso al espacio no se sabe que existe, salvo para quien administra espacios.
    if (level === null && !ctx.actor.capabilities.includes("spaces.manage")) throw notFound();
    if (!canManageSpace(ctx, level)) throw forbidden();
  }
  return await explainTarget(
    ctx,
    { nodeId: null, spaceId: space.id },
    { name: space.name, nodeType: null },
    query,
  );
}
