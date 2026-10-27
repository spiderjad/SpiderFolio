// Accesos pensados en personas: por espacio (quién entra, agrupado por nivel) y por persona (a qué
// elementos compartidos llega). Sale del mismo motor que decide el acceso; los espacios
// confidenciales solo los ve el propietario (igual que el resto de la auditoría).
import { contentMessages } from "../../i18n/index.ts";
import type { AccessLevel, NodeType, Prisma } from "../../generated/prisma/client.ts";
import {
  decodeOffsetCursor,
  encodeOffsetCursor,
  offsetArgs,
  pageOf,
  type Page,
} from "../../lib/pagination.ts";
import { notFound } from "../../lib/errors.ts";
import type { AdminContext } from "../admin/admin-context.ts";
import { userMediaUrl } from "../profile-media/profile-media.service.ts";
import {
  computeAccess,
  expiryFilter,
  levelRank,
  loadAccessGraph,
  subjectFilter,
  type AccessReason,
} from "./access.ts";
import { loadPersonActors, type PersonActor } from "./access-actors.ts";
import type { PersonQuery, SpacesOverviewQuery } from "./access-audit.schemas.ts";

const visibleSpaces = (ctx: AdminContext): Prisma.SpaceWhereInput =>
  ctx.tenant.role.base === "OWNER" ? {} : { isConfidential: false };

/** Personas que se listan por grupo (el resto se cuenta). */
const GROUP_PEOPLE_CAP = 100;
/** Elementos compartidos que se muestran por espacio. */
const SHARED_INSIDE_CAP = 8;
const LEVEL_ORDER: readonly AccessLevel[] = ["MANAGE", "EDIT", "COMMENT", "VIEW"];

export interface PersonRef {
  membershipId: string;
  name: string;
  avatarUrl: string | null;
}

export type OverviewEntry =
  | {
      type: "person";
      person: PersonRef;
      /** Por qué entra (el motivo que decide). */
      reason: AccessReason;
      departmentName: string | null;
    }
  | {
      type: "group";
      /** «company»: toda la empresa; si no, un departamento. */
      key: string;
      label: string;
      count: number;
      people: PersonRef[];
      reason: AccessReason;
    };

export interface SpaceOverview {
  id: string;
  name: string;
  isPrivate: boolean;
  isConfidential: boolean;
  department: { id: string; name: string } | null;
  groups: { level: AccessLevel; entries: OverviewEntry[]; people: number }[];
  sharedInside: {
    items: {
      node: { id: string; name: string; type: NodeType };
      grants: {
        subject: { type: "person" | "department" | "company"; name: string };
        level: AccessLevel;
        expiresAt: Date | null;
      }[];
    }[];
    /** Cuántos elementos compartidos más hay (no se listan). */
    more: number;
  };
}

/** Quién entra a cada espacio de la página, agrupado por el nivel con que entra. */
export async function spacesOverview(
  ctx: AdminContext,
  query: SpacesOverviewQuery,
): Promise<Page<SpaceOverview> & { truncated: boolean }> {
  const where: Prisma.SpaceWhereInput = {
    archivedAt: null,
    ...visibleSpaces(ctx),
    ...(query.q === undefined || query.q === ""
      ? {}
      : { name: { contains: query.q, mode: "insensitive" } }),
  };
  const [spaces, total, loaded, departments] = await Promise.all([
    ctx.db.space.findMany({
      where,
      orderBy: [{ name: "asc" }, { id: "asc" }],
      ...offsetArgs(query),
      select: {
        id: true,
        name: true,
        isPrivate: true,
        isConfidential: true,
        department: { select: { id: true, name: true } },
      },
    }),
    ctx.db.space.count({ where }),
    loadPersonActors(ctx.db),
    ctx.db.department.findMany({ select: { id: true, name: true } }),
  ]);
  const spaceIds = spaces.map((space) => space.id);
  const [graph, avatars, sharedRows] = await Promise.all([
    loadAccessGraph(ctx.db, { spaceIds }),
    ctx.db.membership.findMany({
      where: { id: { in: loaded.people.map((p) => p.membershipId) } },
      select: { id: true, user: { select: { id: true, avatarKey: true } } },
    }),
    spaceIds.length === 0
      ? []
      : ctx.db.permission.findMany({
          where: {
            nodeId: { not: null },
            node: { spaceId: { in: spaceIds }, trashedAt: null },
            AND: [expiryFilter(new Date())],
          },
          orderBy: [{ node: { nameKey: "asc" } }, { id: "asc" }],
          take: 2000,
          select: {
            level: true,
            expiresAt: true,
            everyone: true,
            node: { select: { id: true, name: true, type: true, spaceId: true } },
            department: { select: { name: true } },
            membership: { select: { user: { select: { name: true } } } },
          },
        }),
  ]);
  const avatarOf = new Map<string, string | null>();
  for (const membership of avatars) {
    avatarOf.set(
      membership.id,
      userMediaUrl("avatar", membership.user.id, membership.user.avatarKey),
    );
  }
  const departmentName = new Map(departments.map((d) => [d.id, d.name]));
  const refOf = (person: PersonActor): PersonRef => ({
    membershipId: person.membershipId,
    name: person.name,
    avatarUrl: avatarOf.get(person.membershipId) ?? null,
  });
  const resolvers = loaded.people.map((person) => ({
    person,
    resolver: computeAccess(person.actor, graph),
  }));
  // Propietario y administradores primero; el resto, por nombre.
  const weight = (person: PersonActor) =>
    person.role.base === "OWNER" ? 0 : person.role.base === "ADMIN" ? 1 : 2;

  const items = spaces.map((space): SpaceOverview => {
    const byLevel = new Map<AccessLevel, OverviewEntry[]>();
    const counts = new Map<AccessLevel, number>();
    const buckets = new Map<string, Extract<OverviewEntry, { type: "group" }>>();
    const individuals: { weight: number; level: AccessLevel; entry: OverviewEntry }[] = [];
    for (const { person, resolver } of resolvers) {
      const explanation = resolver.explainSpace(space.id);
      const primary = explanation.reasons[0];
      if (explanation.level === null || primary === undefined) continue;
      counts.set(explanation.level, (counts.get(explanation.level) ?? 0) + 1);
      const reason = primary.reason;
      const departmentId =
        "departmentId" in reason && typeof reason.departmentId === "string"
          ? reason.departmentId
          : null;
      const asGroup =
        reason.kind === "company" ||
        reason.kind === "visible" ||
        reason.kind === "member" ||
        (reason.kind === "grant" && (reason.via === "department" || reason.via === "company"));
      if (asGroup) {
        const company =
          reason.kind === "company" ||
          reason.kind === "visible" ||
          (reason.kind === "grant" && reason.via === "company");
        const key = `${explanation.level}:${company ? "company" : (departmentId ?? "")}`;
        let group = buckets.get(key);
        if (group === undefined) {
          group = {
            type: "group",
            key: company ? "company" : (departmentId ?? ""),
            label: company ? "" : (departmentName.get(departmentId ?? "") ?? ""),
            count: 0,
            people: [],
            reason,
          };
          buckets.set(key, group);
        }
        group.count += 1;
        if (group.people.length < GROUP_PEOPLE_CAP) group.people.push(refOf(person));
      } else {
        individuals.push({
          weight: weight(person),
          level: explanation.level,
          entry: {
            type: "person",
            person: refOf(person),
            reason,
            departmentName:
              departmentId === null ? null : (departmentName.get(departmentId) ?? null),
          },
        });
      }
    }
    individuals.sort(
      (a, b) =>
        a.weight - b.weight ||
        (a.entry.type === "person" && b.entry.type === "person"
          ? a.entry.person.name.localeCompare(b.entry.person.name, "es")
          : 0),
    );
    for (const { level, entry } of individuals) {
      byLevel.set(level, [...(byLevel.get(level) ?? []), entry]);
    }
    for (const [key, group] of buckets) {
      const level = key.split(":")[0] as AccessLevel;
      group.people.sort((a, b) => a.name.localeCompare(b.name, "es"));
      byLevel.set(level, [...(byLevel.get(level) ?? []), group]);
    }
    // Compartido dentro: por elemento, con quién y hasta cuándo.
    const nodes = new Map<string, SpaceOverview["sharedInside"]["items"][number]>();
    for (const row of sharedRows) {
      if (row.node === null || row.node.spaceId !== space.id) continue;
      const subject = row.everyone
        ? { type: "company" as const, name: contentMessages.companyName }
        : row.department !== null
          ? { type: "department" as const, name: row.department.name }
          : row.membership !== null
            ? { type: "person" as const, name: row.membership.user.name }
            : null;
      if (subject === null) continue;
      const current = nodes.get(row.node.id) ?? {
        node: { id: row.node.id, name: row.node.name, type: row.node.type },
        grants: [],
      };
      current.grants.push({ subject, level: row.level, expiresAt: row.expiresAt });
      nodes.set(row.node.id, current);
    }
    const shared = [...nodes.values()];
    return {
      id: space.id,
      name: space.name,
      isPrivate: space.isPrivate,
      isConfidential: space.isConfidential,
      department: space.department,
      groups: LEVEL_ORDER.flatMap((level) => {
        const entries = byLevel.get(level);
        return entries === undefined ? [] : [{ level, entries, people: counts.get(level) ?? 0 }];
      }),
      sharedInside: {
        items: shared.slice(0, SHARED_INSIDE_CAP),
        more: Math.max(0, shared.length - SHARED_INSIDE_CAP),
      },
    };
  });
  return { ...pageOf(items, total, query), truncated: loaded.truncated };
}

// ─── Por persona: los elementos a los que entra ──────────────────────────────────────────

export interface PersonItem {
  node: { id: string; name: string; type: NodeType; spaceId: string; spaceName: string };
  level: AccessLevel;
  reason: AccessReason;
  departmentName: string | null;
  sharedBy: string | null;
  sharedAt: Date | null;
  expiresAt: Date | null;
}

const BATCH = 50;
const MAX_BATCHES = 10;

/** Carpetas, páginas y archivos con un acceso dado a la persona (o a sus departamentos), con su motivo. */
export async function personItems(
  ctx: AdminContext,
  membershipId: string,
  query: PersonQuery,
): Promise<Pick<Page<PersonItem>, "items" | "nextCursor">> {
  const { people } = await loadPersonActors(ctx.db, { membershipIds: [membershipId] });
  const person = people[0];
  if (person === undefined) throw notFound();
  const mine: Prisma.PermissionWhereInput = {
    AND: [subjectFilter(person.actor, { company: false }), expiryFilter(new Date())],
  };
  const where: Prisma.NodeWhereInput = {
    trashedAt: null,
    space: visibleSpaces(ctx),
    permissions: { some: mine },
    ...(query.q === undefined || query.q === ""
      ? {}
      : { name: { contains: query.q, mode: "insensitive" } }),
  };
  const departments = new Map(
    (await ctx.db.department.findMany({ select: { id: true, name: true } })).map((d) => [
      d.id,
      d.name,
    ]),
  );
  let offset = (query.cursor === undefined ? null : decodeOffsetCursor(query.cursor)) ?? 0;
  const items: PersonItem[] = [];
  for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
    const rows = await ctx.db.node.findMany({
      where,
      orderBy: [{ nameKey: "asc" }, { id: "asc" }],
      skip: offset,
      take: BATCH,
      select: {
        id: true,
        name: true,
        type: true,
        spaceId: true,
        space: { select: { name: true } },
        permissions: {
          where: mine,
          select: { level: true, createdAt: true, expiresAt: true, grantedById: true },
        },
      },
    });
    const graph = await loadAccessGraph(ctx.db, {
      nodeIds: rows.map((row) => row.id),
      spaceIds: [...new Set(rows.map((row) => row.spaceId))],
    });
    const resolver = computeAccess(person.actor, graph);
    const grantors = new Map(
      (
        await ctx.db.membership.findMany({
          where: {
            id: {
              in: [...new Set(rows.flatMap((row) => row.permissions.map((p) => p.grantedById)))],
            },
          },
          select: { id: true, user: { select: { name: true } } },
        })
      ).map((member) => [member.id, member.user.name]),
    );
    for (const [index, row] of rows.entries()) {
      const explanation = resolver.explainNode(row.id);
      const primary = explanation.reasons[0];
      if (explanation.level === null || primary === undefined) continue;
      const best = [...row.permissions].sort(
        (a, b) =>
          levelRank[b.level] - levelRank[a.level] || b.createdAt.getTime() - a.createdAt.getTime(),
      )[0];
      const reason = primary.reason;
      const departmentId =
        "departmentId" in reason && typeof reason.departmentId === "string"
          ? reason.departmentId
          : null;
      items.push({
        node: {
          id: row.id,
          name: row.name,
          type: row.type,
          spaceId: row.spaceId,
          spaceName: row.space.name,
        },
        level: explanation.level,
        reason,
        departmentName: departmentId === null ? null : (departments.get(departmentId) ?? null),
        sharedBy: best === undefined ? null : (grantors.get(best.grantedById) ?? null),
        sharedAt: best?.createdAt ?? null,
        expiresAt: best?.expiresAt ?? null,
      });
      if (items.length === query.pageSize) {
        return { items, nextCursor: encodeOffsetCursor(offset + index + 1) };
      }
    }
    offset += rows.length;
    if (rows.length < BATCH) return { items, nextCursor: null };
  }
  return { items, nextCursor: encodeOffsetCursor(offset) };
}
