// Tabla de casos de resolveAccess (docs/spec/acceso-a-contenido.md, 8.2). Función pura: sin base.
import { describe, expect, it } from "vitest";
import type { AccessLevel } from "../src/generated/prisma/client.ts";
import {
  computeAccess,
  type AccessActor,
  type AccessGrant,
  type AccessNode,
} from "../src/modules/access/access.ts";

const NOW = new Date("2026-10-21T10:00:00Z");
const PAST = new Date("2026-10-01T00:00:00Z");
const FUTURE = new Date("2026-12-01T00:00:00Z");

// Árbol: espacio S → A → B → C, y A2 hermano de A (raíz).
const nodes = (overrides: Record<string, Partial<AccessNode>> = {}) =>
  new Map<string, AccessNode>(
    (
      [
        { id: "A", parentId: null, spaceId: "S", inheritAccess: true },
        { id: "B", parentId: "A", spaceId: "S", inheritAccess: true },
        { id: "C", parentId: "B", spaceId: "S", inheritAccess: true },
        { id: "A2", parentId: null, spaceId: "S", inheritAccess: true },
      ] satisfies AccessNode[]
    ).map((node) => [node.id, { ...node, ...overrides[node.id] }]),
  );

// Sin `ownDepartmentIds`, los departamentos de la persona son los de `departmentIds` (sin ancestros).
const actor = (changes: Partial<AccessActor> = {}): AccessActor => ({
  membershipId: "me",
  base: "MEMBER",
  seatType: "FULL",
  bypass: false,
  departmentIds: new Set(["calidad"]),
  ownDepartmentIds: changes.departmentIds ?? new Set(["calidad"]),
  ledScope: new Map(),
  ...changes,
});

const grant = (changes: Partial<AccessGrant> & { level: AccessLevel }): AccessGrant => ({
  nodeId: null,
  spaceId: null,
  membershipId: null,
  departmentId: null,
  everyone: false,
  expiresAt: null,
  includeSubareas: true,
  ...changes,
});

function levels(
  who: AccessActor,
  options: {
    isPrivate?: boolean;
    departmentId?: string | null;
    departmentLevel?: AccessLevel;
    grants?: AccessGrant[];
    tree?: Map<string, AccessNode>;
  } = {},
) {
  const resolver = computeAccess(
    who,
    {
      nodes: options.tree ?? nodes(),
      spaces: new Map([
        [
          "S",
          {
            id: "S",
            isPrivate: options.isPrivate ?? false,
            isConfidential: false,
            departmentId: options.departmentId ?? null,
            departmentLevel: options.departmentLevel ?? "EDIT",
            includeSubareas: false,
          },
        ],
      ]),
      grants: options.grants ?? [],
    },
    NOW,
  );
  return {
    space: resolver.ofSpace("S"),
    A: resolver.ofNode("A"),
    B: resolver.ofNode("B"),
    C: resolver.ofNode("C"),
    A2: resolver.ofNode("A2"),
  };
}

describe("computeAccess: acceso total", () => {
  it.each([
    ["propietario", actor({ base: "OWNER" })],
    ["administrador", actor({ base: "ADMIN" })],
    ["content.bypass", actor({ bypass: true })],
  ])("%s tiene MANAGE en todo, aun en un espacio privado y sin permisos", (_name, who) => {
    expect(levels(who, { isPrivate: true })).toEqual({
      space: "MANAGE",
      A: "MANAGE",
      B: "MANAGE",
      C: "MANAGE",
      A2: "MANAGE",
    });
  });
});

describe("computeAccess: espacio no privado y privado", () => {
  it("un miembro tiene VIEW en todo un espacio no privado", () => {
    expect(levels(actor())).toEqual({ space: "VIEW", A: "VIEW", B: "VIEW", C: "VIEW", A2: "VIEW" });
  });

  it("un espacio privado no da nada sin permiso explícito", () => {
    expect(levels(actor(), { isPrivate: true })).toEqual({
      space: null,
      A: null,
      B: null,
      C: null,
      A2: null,
    });
  });

  it("un invitado externo no ve un espacio no privado", () => {
    expect(levels(actor({ base: "GUEST", seatType: "READER" })).space).toBeNull();
  });
});

describe("computeAccess: permisos y herencia", () => {
  it("un permiso del espacio para el departamento llega a todo el árbol", () => {
    const result = levels(actor(), {
      grants: [grant({ spaceId: "S", departmentId: "calidad", level: "EDIT" })],
    });
    expect(result).toEqual({ space: "EDIT", A: "EDIT", B: "EDIT", C: "EDIT", A2: "EDIT" });
  });

  it("un permiso para un departamento padre (incluido en los de la persona) también vale", () => {
    const who = actor({ departmentIds: new Set(["laboratorio", "calidad"]) });
    const result = levels(who, {
      isPrivate: true,
      grants: [grant({ nodeId: "A", departmentId: "calidad", level: "EDIT" })],
    });
    expect(result.A).toBe("EDIT");
    expect(result.C).toBe("EDIT");
  });

  it("un permiso en un nodo baja a sus hijos y no sube ni va a los hermanos", () => {
    const result = levels(actor(), {
      isPrivate: true,
      grants: [grant({ nodeId: "B", membershipId: "me", level: "EDIT" })],
    });
    expect(result).toEqual({ space: null, A: null, B: "EDIT", C: "EDIT", A2: null });
  });

  it("gana el nivel más alto entre lo propio y lo heredado", () => {
    const result = levels(actor(), {
      grants: [
        grant({ spaceId: "S", departmentId: "calidad", level: "COMMENT" }),
        grant({ nodeId: "B", membershipId: "me", level: "MANAGE" }),
        grant({ nodeId: "B", departmentId: "calidad", level: "VIEW" }),
      ],
    });
    expect(result).toMatchObject({ A: "COMMENT", B: "MANAGE", C: "MANAGE" });
  });

  it("sin herencia el nodo corta lo del padre y del espacio", () => {
    const tree = nodes({ B: { inheritAccess: false } });
    const result = levels(actor(), {
      grants: [grant({ spaceId: "S", departmentId: "calidad", level: "EDIT" })],
      tree,
    });
    expect(result).toMatchObject({ A: "EDIT", B: null, C: null });
  });

  it("sin herencia, lo explícito del nodo sigue valiendo y baja a los hijos", () => {
    const tree = nodes({ B: { inheritAccess: false } });
    const result = levels(actor(), {
      grants: [
        grant({ spaceId: "S", departmentId: "calidad", level: "EDIT" }),
        grant({ nodeId: "B", membershipId: "me", level: "VIEW" }),
      ],
      tree,
    });
    expect(result).toMatchObject({ A: "EDIT", B: "VIEW", C: "VIEW" });
  });

  it("un nodo raíz sin herencia no recibe ni el VIEW base del espacio", () => {
    const tree = nodes({ A: { inheritAccess: false } });
    const result = levels(actor(), { tree });
    expect(result).toMatchObject({ space: "VIEW", A: null, B: null, A2: "VIEW" });
  });

  it("ignora permisos de otras personas y de otros departamentos", () => {
    const result = levels(actor(), {
      isPrivate: true,
      grants: [
        grant({ spaceId: "S", membershipId: "otra", level: "MANAGE" }),
        grant({ spaceId: "S", departmentId: "compras", level: "MANAGE" }),
      ],
    });
    expect(result.space).toBeNull();
  });

  it("ignora los permisos vencidos y respeta los que vencen más adelante", () => {
    const grants = [
      grant({ spaceId: "S", membershipId: "me", level: "EDIT", expiresAt: PAST }),
      grant({ nodeId: "A", membershipId: "me", level: "COMMENT", expiresAt: FUTURE }),
    ];
    const result = levels(actor(), { isPrivate: true, grants });
    expect(result).toMatchObject({ space: null, A: "COMMENT" });
  });
});

describe("computeAccess: lectores e invitados", () => {
  it.each([
    ["lector", actor({ seatType: "READER" })],
    ["invitado", actor({ base: "GUEST", seatType: "READER" })],
  ])("%s nunca pasa de COMMENT, aunque le den EDIT o MANAGE", (_name, who) => {
    const result = levels(who, {
      isPrivate: true,
      grants: [
        grant({ nodeId: "A", membershipId: "me", level: "MANAGE" }),
        grant({ nodeId: "A2", departmentId: "calidad", level: "EDIT" }),
        grant({ nodeId: "B", membershipId: "me", level: "VIEW" }),
      ],
    });
    expect(result).toMatchObject({ A: "COMMENT", A2: "COMMENT", B: "COMMENT", C: "COMMENT" });
  });

  it("un lector con VIEW conserva VIEW", () => {
    const result = levels(actor({ seatType: "READER" }), {
      isPrivate: true,
      grants: [grant({ nodeId: "A", membershipId: "me", level: "VIEW" })],
    });
    expect(result.A).toBe("VIEW");
  });

  it("el invitado ve solo lo compartido de forma explícita", () => {
    const result = levels(actor({ base: "GUEST", seatType: "READER" }), {
      grants: [grant({ nodeId: "B", membershipId: "me", level: "VIEW" })],
    });
    expect(result).toEqual({ space: null, A: null, B: "VIEW", C: "VIEW", A2: null });
  });
});

describe("computeAccess: grafos raros", () => {
  it("un padre que falta en el grafo corta la herencia (se niega)", () => {
    const tree = new Map<string, AccessNode>([
      ["C", { id: "C", parentId: "perdido", spaceId: "S", inheritAccess: true }],
    ]);
    expect(levels(actor(), { tree }).C).toBeNull();
  });

  it("un ciclo no cuelga el cálculo", () => {
    const tree = new Map<string, AccessNode>([
      ["A", { id: "A", parentId: "B", spaceId: "S", inheritAccess: true }],
      ["B", { id: "B", parentId: "A", spaceId: "S", inheritAccess: true }],
    ]);
    const resolver = computeAccess(
      actor(),
      {
        nodes: tree,
        spaces: new Map([
          [
            "S",
            {
              id: "S",
              isPrivate: false,
              isConfidential: false,
              departmentId: null,
              departmentLevel: "EDIT",
              includeSubareas: false,
            },
          ],
        ]),
        grants: [],
      },
      NOW,
    );
    expect(resolver.ofNode("A")).toBeNull();
  });

  it("un espacio desconocido no da acceso", () => {
    const resolver = computeAccess(
      actor(),
      { nodes: new Map(), spaces: new Map(), grants: [] },
      NOW,
    );
    expect(resolver.ofSpace("X")).toBeNull();
    expect(resolver.ofNode("X")).toBeNull();
  });
});

// ─── Espacios de un departamento ─────────────────────────────────────────────────────────
// Departamentos: finanzas → tesoreria (subdepartamento); contabilidad aparte.
const led = (departmentId: string, rank: "HEAD" | "DEPUTY", scope: string[]) =>
  new Map(scope.map((id) => [id, { departmentId, rank }] as const));

function deptSpace(
  who: AccessActor,
  options: {
    departmentId?: string | null;
    departmentLevel?: AccessLevel;
    isPrivate?: boolean;
    isConfidential?: boolean;
    includeSubareas?: boolean;
    grants?: AccessGrant[];
  } = {},
) {
  const resolver = computeAccess(
    who,
    {
      nodes: nodes(),
      spaces: new Map([
        [
          "S",
          {
            id: "S",
            isPrivate: options.isPrivate ?? options.isConfidential ?? false,
            isConfidential: options.isConfidential ?? false,
            departmentId: options.departmentId === undefined ? "finanzas" : options.departmentId,
            departmentLevel: options.departmentLevel ?? "EDIT",
            includeSubareas: options.includeSubareas ?? false,
          },
        ],
      ]),
      grants: options.grants ?? [],
    },
    NOW,
  );
  return {
    level: resolver.ofSpace("S"),
    reason: resolver.reasonOfSpace("S"),
    A: resolver.ofNode("A"),
  };
}

describe("computeAccess: espacios de departamento", () => {
  const FIN = "finanzas";
  const cases: {
    name: string;
    who: AccessActor;
    options?: Parameters<typeof deptSpace>[1];
    level: AccessLevel | null;
    reason: object | null;
  }[] = [
    {
      name: "el jefe del departamento gestiona su espacio",
      who: actor({
        departmentIds: new Set([FIN]),
        ledScope: led(FIN, "HEAD", [FIN, "tesoreria"]),
      }),
      level: "MANAGE",
      reason: { kind: "leader", rank: "HEAD", departmentId: FIN },
    },
    {
      name: "el subjefe también",
      who: actor({
        departmentIds: new Set([FIN]),
        ledScope: led(FIN, "DEPUTY", [FIN, "tesoreria"]),
      }),
      level: "MANAGE",
      reason: { kind: "leader", rank: "DEPUTY", departmentId: FIN },
    },
    {
      name: "el jefe del departamento padre gestiona el espacio del subdepartamento",
      who: actor({
        departmentIds: new Set([FIN]),
        ledScope: led(FIN, "HEAD", [FIN, "tesoreria"]),
      }),
      options: { departmentId: "tesoreria" },
      level: "MANAGE",
      reason: { kind: "leader", rank: "HEAD", departmentId: FIN },
    },
    {
      name: "el jefe de un subdepartamento no gestiona el espacio del padre ni entra como miembro",
      who: actor({
        departmentIds: new Set(["tesoreria", FIN]),
        ownDepartmentIds: new Set(["tesoreria"]),
        ledScope: led("tesoreria", "HEAD", ["tesoreria"]),
      }),
      level: "VIEW",
      reason: { kind: "visible", departmentId: FIN },
    },
    {
      name: "con subáreas, el jefe del subdepartamento entra al espacio del padre como miembro",
      who: actor({
        departmentIds: new Set(["tesoreria", FIN]),
        ownDepartmentIds: new Set(["tesoreria"]),
        ledScope: led("tesoreria", "HEAD", ["tesoreria"]),
      }),
      options: { includeSubareas: true },
      level: "EDIT",
      reason: { kind: "member", departmentId: FIN, subareas: true },
    },
    {
      name: "un miembro edita por defecto",
      who: actor({ departmentIds: new Set([FIN]) }),
      level: "EDIT",
      reason: { kind: "member", departmentId: FIN, subareas: false },
    },
    {
      name: "por defecto, un miembro de un subdepartamento solo ve el espacio del departamento",
      who: actor({
        departmentIds: new Set(["tesoreria", FIN]),
        ownDepartmentIds: new Set(["tesoreria"]),
      }),
      level: "VIEW",
      reason: { kind: "visible", departmentId: FIN },
    },
    {
      name: "por defecto, un miembro de un subdepartamento no entra a un espacio privado del padre",
      who: actor({
        departmentIds: new Set(["tesoreria", FIN]),
        ownDepartmentIds: new Set(["tesoreria"]),
      }),
      options: { isPrivate: true },
      level: null,
      reason: null,
    },
    {
      name: "con subáreas, un miembro de un subdepartamento edita en el espacio del padre",
      who: actor({
        departmentIds: new Set(["tesoreria", FIN]),
        ownDepartmentIds: new Set(["tesoreria"]),
      }),
      options: { includeSubareas: true, isPrivate: true },
      level: "EDIT",
      reason: { kind: "member", departmentId: FIN, subareas: true },
    },
    {
      name: "con subáreas, el nivel del espacio también rige para el subdepartamento",
      who: actor({
        departmentIds: new Set(["tesoreria", FIN]),
        ownDepartmentIds: new Set(["tesoreria"]),
      }),
      options: { includeSubareas: true, departmentLevel: "VIEW" },
      level: "VIEW",
      reason: { kind: "member", departmentId: FIN, subareas: true },
    },
    {
      name: "con subáreas, un miembro del propio departamento lo ve explicado así",
      who: actor({ departmentIds: new Set([FIN]) }),
      options: { includeSubareas: true },
      level: "EDIT",
      reason: { kind: "member", departmentId: FIN, subareas: true },
    },
    {
      name: "las subáreas no suben: un miembro del padre no entra al espacio del subdepartamento",
      who: actor({ departmentIds: new Set([FIN]) }),
      options: { departmentId: "tesoreria", includeSubareas: true, isPrivate: true },
      level: null,
      reason: null,
    },
    {
      name: "un miembro solo ve si el espacio lo configura así",
      who: actor({ departmentIds: new Set([FIN]) }),
      options: { departmentLevel: "VIEW" },
      level: "VIEW",
      reason: { kind: "member", departmentId: FIN, subareas: false },
    },
    {
      name: "un miembro del departamento entra aunque el espacio sea privado",
      who: actor({ departmentIds: new Set([FIN]) }),
      options: { isPrivate: true },
      level: "EDIT",
      reason: { kind: "member", departmentId: FIN, subareas: false },
    },
    {
      name: "otro departamento ve un espacio no privado, solo lectura",
      who: actor({ departmentIds: new Set(["contabilidad"]) }),
      level: "VIEW",
      reason: { kind: "visible", departmentId: FIN },
    },
    {
      name: "otro departamento no ve un espacio privado",
      who: actor({ departmentIds: new Set(["contabilidad"]) }),
      options: { isPrivate: true },
      level: null,
      reason: null,
    },
    {
      name: "el jefe de otro departamento no gestiona este espacio",
      who: actor({
        departmentIds: new Set(["contabilidad"]),
        ledScope: led("contabilidad", "HEAD", ["contabilidad"]),
      }),
      options: { isPrivate: true },
      level: null,
      reason: null,
    },
    {
      name: "un lector del departamento ve (como mucho VIEW)",
      who: actor({ seatType: "READER", departmentIds: new Set([FIN]) }),
      level: "VIEW",
      reason: { kind: "member", departmentId: FIN, subareas: false },
    },
    {
      name: "un lector con cargo de jefe no gana alcance: VIEW",
      who: actor({
        seatType: "READER",
        departmentIds: new Set([FIN]),
        ledScope: led(FIN, "HEAD", [FIN]),
      }),
      level: "VIEW",
      reason: { kind: "leader", rank: "HEAD", departmentId: FIN },
    },
    {
      name: "un invitado no recibe nada por estar en el departamento",
      who: actor({ base: "GUEST", departmentIds: new Set([FIN]) }),
      level: null,
      reason: null,
    },
    {
      name: "un acceso explícito mayor al del departamento gana",
      who: actor({ departmentIds: new Set([FIN]) }),
      options: { grants: [grant({ spaceId: "S", membershipId: "me", level: "MANAGE" })] },
      level: "MANAGE",
      reason: { kind: "grant", via: "person", departmentId: null, expiresAt: null },
    },
    {
      name: "un acceso explícito a un lector sigue topado en COMMENT",
      who: actor({ seatType: "READER", departmentIds: new Set(["contabilidad"]) }),
      options: {
        isPrivate: true,
        grants: [grant({ spaceId: "S", membershipId: "me", level: "EDIT" })],
      },
      level: "COMMENT",
      reason: { kind: "grant", via: "person", departmentId: null, expiresAt: null },
    },
    {
      name: "el administrador gestiona todo",
      who: actor({ base: "ADMIN" }),
      options: { isPrivate: true },
      level: "MANAGE",
      reason: { kind: "admin" },
    },
    {
      name: "el propietario gestiona todo",
      who: actor({ base: "OWNER" }),
      options: { isPrivate: true },
      level: "MANAGE",
      reason: { kind: "owner" },
    },
    {
      name: "espacio de la empresa: un miembro ve",
      who: actor({ departmentIds: new Set([FIN]) }),
      options: { departmentId: null },
      level: "VIEW",
      reason: { kind: "company" },
    },
    {
      name: "espacio de la empresa: el jefe de un departamento solo ve",
      who: actor({
        departmentIds: new Set([FIN]),
        ledScope: led(FIN, "HEAD", [FIN]),
      }),
      options: { departmentId: null },
      level: "VIEW",
      reason: { kind: "company" },
    },
    {
      name: "espacio de la empresa privado: nada",
      who: actor({ departmentIds: new Set([FIN]) }),
      options: { departmentId: null, isPrivate: true },
      level: null,
      reason: null,
    },
  ];

  it.each(cases)("$name", ({ who, options, level, reason }) => {
    const result = deptSpace(who, options);
    expect(result.level).toBe(level);
    expect(result.reason).toEqual(reason);
  });

  it("el nivel del espacio llega a sus carpetas, y se corta si la carpeta no hereda", () => {
    const resolver = computeAccess(
      actor({ departmentIds: new Set([FIN]) }),
      {
        nodes: nodes({ A2: { inheritAccess: false } }),
        spaces: new Map([
          [
            "S",
            {
              id: "S",
              isPrivate: true,
              isConfidential: false,
              departmentId: FIN,
              departmentLevel: "EDIT",
              includeSubareas: false,
            },
          ],
        ]),
        grants: [],
      },
      NOW,
    );
    expect(resolver.ofNode("C")).toBe("EDIT");
    expect(resolver.ofNode("A2")).toBeNull();
  });
});

// ─── Espacios confidenciales ─────────────────────────────────────────────────────────────
describe("computeAccess: espacios confidenciales", () => {
  const FIN = "finanzas";
  const OPTIONS = { isConfidential: true } as const;
  const subarea = {
    departmentIds: new Set(["tesoreria", FIN]),
    ownDepartmentIds: new Set(["tesoreria"]),
  };
  const cases: {
    name: string;
    who: AccessActor;
    options?: Parameters<typeof deptSpace>[1];
    level: AccessLevel | null;
    reason: object | null;
  }[] = [
    {
      name: "el propietario del workspace entra solo",
      who: actor({ base: "OWNER" }),
      level: "MANAGE",
      reason: { kind: "owner" },
    },
    {
      name: "el administrador no entra solo",
      who: actor({ base: "ADMIN" }),
      level: null,
      reason: null,
    },
    {
      name: "content.bypass no entra solo",
      who: actor({ bypass: true, departmentIds: new Set(["contabilidad"]) }),
      level: null,
      reason: null,
    },
    {
      name: "el administrador que es jefe del departamento gestiona",
      who: actor({
        base: "ADMIN",
        departmentIds: new Set([FIN]),
        ledScope: led(FIN, "HEAD", [FIN, "tesoreria"]),
      }),
      level: "MANAGE",
      reason: { kind: "leader", rank: "HEAD", departmentId: FIN },
    },
    {
      name: "el administrador que es miembro del departamento entra como miembro",
      who: actor({ base: "ADMIN", departmentIds: new Set([FIN]) }),
      level: "EDIT",
      reason: { kind: "member", departmentId: FIN, subareas: false },
    },
    {
      name: "el administrador agregado explícitamente entra con ese nivel",
      who: actor({ base: "ADMIN" }),
      options: { grants: [grant({ spaceId: "S", membershipId: "me", level: "VIEW" })] },
      level: "VIEW",
      reason: { kind: "grant", via: "person", departmentId: null, expiresAt: null },
    },
    {
      name: "el jefe del departamento gestiona",
      who: actor({ departmentIds: new Set([FIN]), ledScope: led(FIN, "HEAD", [FIN]) }),
      level: "MANAGE",
      reason: { kind: "leader", rank: "HEAD", departmentId: FIN },
    },
    {
      name: "el subjefe del departamento gestiona",
      who: actor({ departmentIds: new Set([FIN]), ledScope: led(FIN, "DEPUTY", [FIN]) }),
      level: "MANAGE",
      reason: { kind: "leader", rank: "DEPUTY", departmentId: FIN },
    },
    {
      name: "el jefe de un área superior gestiona el espacio confidencial del subdepartamento",
      who: actor({
        departmentIds: new Set([FIN]),
        ledScope: led(FIN, "HEAD", [FIN, "tesoreria"]),
      }),
      options: { departmentId: "tesoreria" },
      level: "MANAGE",
      reason: { kind: "leader", rank: "HEAD", departmentId: FIN },
    },
    {
      name: "un miembro del departamento entra",
      who: actor({ departmentIds: new Set([FIN]) }),
      level: "EDIT",
      reason: { kind: "member", departmentId: FIN, subareas: false },
    },
    {
      name: "un miembro de un subdepartamento no entra con subáreas desactivadas",
      who: actor(subarea),
      level: null,
      reason: null,
    },
    {
      name: "un miembro de un subdepartamento entra si el espacio incluye subáreas",
      who: actor(subarea),
      options: { includeSubareas: true },
      level: "EDIT",
      reason: { kind: "member", departmentId: FIN, subareas: true },
    },
    {
      name: "otro departamento no lo ve",
      who: actor({ departmentIds: new Set(["contabilidad"]) }),
      level: null,
      reason: null,
    },
    {
      name: "el jefe de otro departamento tampoco",
      who: actor({
        departmentIds: new Set(["contabilidad"]),
        ledScope: led("contabilidad", "HEAD", ["contabilidad"]),
      }),
      level: null,
      reason: null,
    },
    {
      name: "una persona agregada explícitamente entra",
      who: actor({ departmentIds: new Set(["contabilidad"]) }),
      options: { grants: [grant({ spaceId: "S", membershipId: "me", level: "EDIT" })] },
      level: "EDIT",
      reason: { kind: "grant", via: "person", departmentId: null, expiresAt: null },
    },
    {
      name: "un departamento agregado explícitamente entra",
      who: actor({ departmentIds: new Set(["contabilidad"]) }),
      options: { grants: [grant({ spaceId: "S", departmentId: "contabilidad", level: "VIEW" })] },
      level: "VIEW",
      reason: { kind: "grant", via: "department", departmentId: "contabilidad", expiresAt: null },
    },
    {
      name: "un permiso vencido no abre el espacio",
      who: actor({ departmentIds: new Set(["contabilidad"]) }),
      options: {
        grants: [grant({ spaceId: "S", membershipId: "me", level: "EDIT", expiresAt: PAST })],
      },
      level: null,
      reason: null,
    },
    {
      name: "un invitado externo no entra por el departamento",
      who: actor({ base: "GUEST", seatType: "READER", departmentIds: new Set([FIN]) }),
      level: null,
      reason: null,
    },
    {
      name: "espacio confidencial de la empresa: el administrador tampoco entra",
      who: actor({ base: "ADMIN" }),
      options: { departmentId: null },
      level: null,
      reason: null,
    },
    {
      name: "espacio confidencial de la empresa: un miembro no ve nada",
      who: actor(),
      options: { departmentId: null },
      level: null,
      reason: null,
    },
  ];

  it.each(cases)("$name", ({ who, options, level, reason }) => {
    const result = deptSpace(who, { ...OPTIONS, ...options });
    expect(result.level).toBe(level);
    expect(result.reason).toEqual(reason);
  });

  it("al administrador sin acceso tampoco le llegan las carpetas", () => {
    expect(deptSpace(actor({ base: "ADMIN" }), OPTIONS).A).toBeNull();
  });

  it("el administrador sigue teniendo MANAGE en un espacio privado no confidencial", () => {
    const result = deptSpace(actor({ base: "ADMIN" }), { isPrivate: true });
    expect(result).toMatchObject({ level: "MANAGE", A: "MANAGE", reason: { kind: "admin" } });
  });

  it("un permiso explícito en una carpeta abre solo esa carpeta al administrador", () => {
    const resolver = computeAccess(
      actor({ base: "ADMIN" }),
      {
        nodes: nodes(),
        spaces: new Map([
          [
            "S",
            {
              id: "S",
              isPrivate: true,
              isConfidential: true,
              departmentId: FIN,
              departmentLevel: "EDIT",
              includeSubareas: false,
            },
          ],
        ]),
        grants: [grant({ nodeId: "B", membershipId: "me", level: "VIEW" })],
      },
      NOW,
    );
    expect(resolver.ofNode("B")).toBe("VIEW");
    expect(resolver.ofNode("A")).toBeNull();
  });
});
