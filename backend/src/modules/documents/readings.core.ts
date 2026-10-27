// Lecturas obligatorias: a quién alcanza cada requisito y en qué estado está cada persona. Solo usa
// la base de un workspace (TenantDb), así lo comparten la API y el job de recordatorios.
import type { TenantDb } from "../../db/tenant.ts";
import type { Prisma } from "../../generated/prisma/client.ts";
import { atLeast, computeAccess, loadAccessGraph } from "../access/access.ts";
import { loadPersonActors } from "../access/access-actors.ts";
import { parentMapOf, withDescendants } from "../departments/department-tree.ts";

/** Plazo que se da a quienes deben releer una versión nueva (a partir de que se publica). */
export const CARRY_OVER_DAYS = 7;
/** Tope de personas que se explican de un documento. */
const MAX_PEOPLE = 5000;

export interface RequirementRow {
  id: string;
  version: number;
  departmentId: string | null;
  membershipId: string | null;
  includeSubareas: boolean;
  dueAt: Date | null;
}

export interface RequiredPerson {
  membershipId: string;
  /** El plazo más cercano de los requisitos que lo alcanzan. */
  dueAt: Date | null;
  /** Por qué debe leerlo: a ella o a uno de sus departamentos. */
  via: "person" | "department";
  /** Departamento que la alcanza (si es por departamento). */
  departmentId: string | null;
}

type Required = Map<string, RequiredPerson>;

/**
 * Las personas activas que alcanzan los requisitos de VARIOS documentos a la vez (el árbol de
 * departamentos, los miembros y las personas sueltas se leen una sola vez). Es la única implementación:
 * `expandRequirements` (un documento) y el Inicio (muchos) pasan por acá, así dan siempre lo mismo.
 */
export async function expandMany(
  db: TenantDb,
  byDocument: ReadonlyMap<string, readonly RequirementRow[]>,
): Promise<Map<string, Required>> {
  const all = [...byDocument.values()].flat();
  const tree = parentMapOf(await db.department.findMany({ select: { id: true, parentId: true } }));
  const reach = new Map<RequirementRow, string[]>();
  for (const requirement of all) {
    if (requirement.departmentId === null) continue;
    reach.set(
      requirement,
      requirement.includeSubareas
        ? withDescendants([requirement.departmentId], tree)
        : [requirement.departmentId],
    );
  }
  const departmentIds = [...new Set([...reach.values()].flat())];
  const personIds = [
    ...new Set(
      all.flatMap((requirement) =>
        requirement.membershipId === null ? [] : [requirement.membershipId],
      ),
    ),
  ];
  const [members, activePeople] = await Promise.all([
    departmentIds.length === 0
      ? []
      : db.departmentMember.findMany({
          where: { departmentId: { in: departmentIds }, membership: { status: "ACTIVE" } },
          take: MAX_PEOPLE * Math.max(1, byDocument.size),
          orderBy: [{ departmentId: "asc" }, { membershipId: "asc" }],
          select: { membershipId: true, departmentId: true },
        }),
    personIds.length === 0
      ? []
      : db.membership.findMany({
          where: { id: { in: personIds }, status: "ACTIVE" },
          select: { id: true },
        }),
  ]);
  const membersOf = new Map<string, { membershipId: string; departmentId: string }[]>();
  for (const member of members) {
    membersOf.set(member.departmentId, [...(membersOf.get(member.departmentId) ?? []), member]);
  }
  const active = new Set(activePeople.map((person) => person.id));

  const result = new Map<string, Required>();
  for (const [key, requirements] of byDocument) {
    const people: Required = new Map();
    const add = (
      membershipId: string,
      via: RequiredPerson["via"],
      departmentId: string | null,
      dueAt: Date | null,
    ) => {
      const current = people.get(membershipId);
      if (current === undefined) {
        people.set(membershipId, { membershipId, via, departmentId, dueAt });
      } else if (dueAt !== null && (current.dueAt === null || dueAt < current.dueAt)) {
        current.dueAt = dueAt;
      }
    };
    for (const requirement of requirements) {
      if (requirement.departmentId !== null) {
        for (const departmentId of reach.get(requirement) ?? []) {
          for (const member of membersOf.get(departmentId) ?? []) {
            add(member.membershipId, "department", member.departmentId, requirement.dueAt);
          }
        }
      } else if (requirement.membershipId !== null && active.has(requirement.membershipId)) {
        add(requirement.membershipId, "person", null, requirement.dueAt);
      }
    }
    result.set(key, people);
  }
  return result;
}

/** Las personas activas que alcanzan estos requisitos, sin repetir. */
export async function expandRequirements(
  db: TenantDb,
  requirements: readonly RequirementRow[],
): Promise<Map<string, RequiredPerson>> {
  return (await expandMany(db, new Map([["", requirements]]))).get("") ?? new Map();
}

/**
 * De esas personas, las que de verdad ven cada documento (si no lo ven, no pueden leerlo): una carga
 * de personas y de permisos para todos los documentos. `whoCanSee` (uno solo) pasa por acá.
 */
export async function whoCanSeeMany(
  db: TenantDb,
  byDocument: ReadonlyMap<string, readonly string[]>,
): Promise<Map<string, Set<string>>> {
  const result = new Map<string, Set<string>>([...byDocument.keys()].map((id) => [id, new Set()]));
  const everyone = [...new Set([...byDocument.values()].flat())];
  if (everyone.length === 0) return result;
  const { people } = await loadPersonActors(db, { membershipIds: everyone });
  const graph = await loadAccessGraph(db, { nodeIds: [...byDocument.keys()] });
  for (const person of people) {
    const resolver = computeAccess(person.actor, graph);
    for (const [nodeId, ids] of byDocument) {
      if (ids.includes(person.membershipId) && atLeast(resolver.ofNode(nodeId), "VIEW")) {
        result.get(nodeId)?.add(person.membershipId);
      }
    }
  }
  return result;
}

/** De esas personas, las que de verdad ven el documento (si no lo ven, no pueden leerlo). */
export async function whoCanSee(
  db: TenantDb,
  nodeId: string,
  membershipIds: readonly string[],
): Promise<Set<string>> {
  if (membershipIds.length === 0) return new Set();
  return (await whoCanSeeMany(db, new Map([[nodeId, membershipIds]]))).get(nodeId) ?? new Set();
}

/** Los requisitos de la versión vigente de un documento y quién ya confirmó. */
export async function currentReadings(db: TenantDb, nodeId: string, version: number) {
  const requirements = await db.readRequirement.findMany({
    where: { nodeId, version },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const required = await expandRequirements(db, requirements);
  const acks = await db.readAcknowledgment.findMany({
    where: { nodeId, version },
    select: { membershipId: true, readAt: true },
  });
  return { requirements, required, acks: new Map(acks.map((a) => [a.membershipId, a.readAt])) };
}

export type ReadingStatus = "read" | "pending" | "overdue" | "noAccess";

export interface ReadingPersonCore {
  membershipId: string;
  status: ReadingStatus;
  readAt: Date | null;
  dueAt: Date | null;
}

export type FullRequirement = Prisma.ReadRequirementGetPayload<object>;

export interface DocumentReadings {
  requirements: FullRequirement[];
  people: ReadingPersonCore[];
}

/**
 * Quién debe leer cada documento y en qué estado está (leyó, pendiente, vencido o sin acceso). Es LA
 * función del cumplimiento de lectura: el detalle de un documento la llama con uno y el Inicio con
 * muchos, y por construcción dan los mismos números.
 */
export async function readingPeopleOf(
  db: TenantDb,
  docs: readonly { nodeId: string; version: number }[],
  now: Date = new Date(),
): Promise<Map<string, DocumentReadings>> {
  const result = new Map<string, DocumentReadings>();
  if (docs.length === 0) return result;
  const pairs = docs.map((doc) => ({ nodeId: doc.nodeId, version: doc.version }));
  const [requirements, acks] = await Promise.all([
    db.readRequirement.findMany({
      where: { OR: pairs },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    db.readAcknowledgment.findMany({
      where: { OR: pairs },
      select: { nodeId: true, version: true, membershipId: true, readAt: true },
    }),
  ]);
  const versionOf = new Map(docs.map((doc) => [doc.nodeId, doc.version]));
  const byDocument = new Map<string, FullRequirement[]>(docs.map((doc) => [doc.nodeId, []]));
  for (const requirement of requirements) {
    if (versionOf.get(requirement.nodeId) === requirement.version) {
      byDocument.get(requirement.nodeId)?.push(requirement);
    }
  }
  const required = await expandMany(db, byDocument);
  const visible = await whoCanSeeMany(
    db,
    new Map(docs.map((doc) => [doc.nodeId, [...(required.get(doc.nodeId)?.keys() ?? [])]])),
  );
  const readAt = new Map<string, Date>();
  for (const ack of acks) {
    if (versionOf.get(ack.nodeId) === ack.version) {
      readAt.set(`${ack.nodeId}:${ack.membershipId}`, ack.readAt);
    }
  }
  for (const doc of docs) {
    const people = [...(required.get(doc.nodeId)?.values() ?? [])].map(
      (person): ReadingPersonCore => {
        const read = readAt.get(`${doc.nodeId}:${person.membershipId}`) ?? null;
        const status: ReadingStatus =
          read !== null
            ? "read"
            : visible.get(doc.nodeId)?.has(person.membershipId) !== true
              ? "noAccess"
              : person.dueAt !== null && person.dueAt < now
                ? "overdue"
                : "pending";
        return { membershipId: person.membershipId, status, readAt: read, dueAt: person.dueAt };
      },
    );
    result.set(doc.nodeId, { requirements: byDocument.get(doc.nodeId) ?? [], people });
  }
  return result;
}

export interface ReadingSummary {
  total: number;
  read: number;
  pending: number;
  overdue: number;
  noAccess: number;
}

/** Los números de cumplimiento de un documento (los del detalle y los del Inicio). */
export function summarize(people: readonly { status: ReadingStatus }[]): ReadingSummary {
  const count = (status: ReadingStatus) => people.filter((p) => p.status === status).length;
  return {
    total: people.length,
    read: count("read"),
    pending: count("pending"),
    overdue: count("overdue"),
    noAccess: count("noAccess"),
  };
}
