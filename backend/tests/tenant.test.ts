// forTenant sin base: un cliente falso registra exactamente qué argumentos le llegarían a
// Prisma. Los casos con la base real están en tests/integration/tenant-db.test.ts.
import { describe, expect, it } from "vitest";
import {
  forTenant,
  transactionClientOf,
  TenantViolation,
  type TenantDb,
} from "../src/db/tenant.ts";
import type { PrismaClient } from "../src/lib/prisma.ts";

interface Call {
  delegate: string;
  op: string;
  args: Record<string, unknown>;
}

function fakeClient() {
  const calls: Call[] = [];
  const delegate = (name: string) =>
    new Proxy(
      {},
      {
        get: (_target, op: string) => (args: Record<string, unknown>) => {
          calls.push({ delegate: name, op, args });
          // Simula un PrismaPromise con API fluida: forTenant no debe exponerla.
          return Object.assign(Promise.resolve({ ok: true }), { role: () => "fluida" });
        },
      },
    );
  const client = {
    workspace: delegate("workspace"),
    role: delegate("role"),
    membership: delegate("membership"),
    workspaceLicense: delegate("workspaceLicense"),
    auditLog: delegate("auditLog"),
    user: delegate("user"),
    session: delegate("session"),
    $queryRaw: () => Promise.resolve([]),
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      calls.push({ delegate: "$transaction", op: "begin", args: {} });
      return await fn(client);
    },
  };
  return { client: client as unknown as PrismaClient, calls };
}

const WS = "ws_a";

/** Llama a una operación elegida en un it.each (unión de firmas genéricas de Prisma). */
const call = (fn: unknown, args: unknown) => (fn as (a: unknown) => Promise<unknown>)(args);

function setup(): { db: TenantDb; calls: Call[] } {
  const { client, calls } = fakeClient();
  return { db: forTenant(client, WS), calls };
}

const last = (calls: Call[]) => {
  const call = calls.at(-1);
  if (call === undefined) throw new Error("Sin llamadas");
  return call;
};

describe("forTenant: filtro del workspace", () => {
  it.each([
    "findMany",
    "findFirst",
    "findFirstOrThrow",
    "count",
    "updateMany",
    "deleteMany",
  ] as const)("%s combina el where con workspaceId", async (op) => {
    const { db, calls } = setup();
    await call(db.role[op], { where: { name: "x" } });
    expect(last(calls).args.where).toEqual({ AND: [{ name: "x" }, { workspaceId: WS }] });
  });

  it("sin where, filtra solo por workspace", async () => {
    const { db, calls } = setup();
    await db.membership.findMany();
    expect(last(calls).args.where).toEqual({ workspaceId: WS });
  });

  it.each(["findUnique", "findUniqueOrThrow", "update", "delete"] as const)(
    "%s agrega el workspace al where único sin perder sus AND",
    async (op) => {
      const { db, calls } = setup();
      await call(db.role[op], { where: { id: "r1", AND: [{ isSystem: false }] }, data: {} });
      expect(last(calls).args.where).toEqual({
        id: "r1",
        AND: [{ isSystem: false }, { workspaceId: WS }],
      });
    },
  );

  it("el workspace se filtra por id", async () => {
    const { db, calls } = setup();
    await db.workspace.findUnique({ where: { id: "otro" } });
    expect(last(calls).args.where).toEqual({ id: "otro", AND: [{ id: WS }] });
  });

  it("aggregate y groupBy también filtran", async () => {
    const { db, calls } = setup();
    await db.auditLog.count({ where: { action: "a" } });
    expect(last(calls).args.where).toEqual({ AND: [{ action: "a" }, { workspaceId: WS }] });
    await db.membership.groupBy({ by: ["status"], _count: true } as never);
    expect(last(calls).args.where).toEqual({ workspaceId: WS });
  });
});

describe("forTenant: creaciones", () => {
  it("create inyecta workspaceId", async () => {
    const { db, calls } = setup();
    await db.role.create({ data: { name: "R", base: "MEMBER" } });
    expect(last(calls).args.data).toEqual({ name: "R", base: "MEMBER", workspaceId: WS });
  });

  it("createMany y createManyAndReturn lo inyectan en cada fila", async () => {
    const { db, calls } = setup();
    await db.role.createMany({
      data: [
        { name: "A", base: "MEMBER" },
        { name: "B", base: "GUEST" },
      ],
    });
    expect(last(calls).args.data).toEqual([
      { name: "A", base: "MEMBER", workspaceId: WS },
      { name: "B", base: "GUEST", workspaceId: WS },
    ]);
    await db.role.createManyAndReturn({ data: { name: "C", base: "ADMIN" } });
    expect(last(calls).args.data).toEqual({ name: "C", base: "ADMIN", workspaceId: WS });
  });

  it("rechaza crear con otro workspaceId", async () => {
    const { db, calls } = setup();
    await expect(
      db.role.create({ data: { name: "R", base: "MEMBER", workspaceId: "ws_b" } as never }),
    ).rejects.toThrow(TenantViolation);
    expect(calls).toHaveLength(0);
  });

  it("acepta su propio workspaceId", async () => {
    const { db } = setup();
    await expect(
      db.role.create({ data: { name: "R", base: "MEMBER", workspaceId: WS } as never }),
    ).resolves.toBeDefined();
  });

  it("upsert filtra el where, inyecta en create y no deja cambiar el tenant en update", async () => {
    const { db, calls } = setup();
    await db.workspaceLicense.upsert({
      where: { workspaceId: "ws_b" },
      create: { token: "p" },
      update: { token: "q" },
    });
    expect(last(calls).args).toMatchObject({
      where: { workspaceId: "ws_b", AND: [{ workspaceId: WS }] },
      create: { token: "p", workspaceId: WS },
      update: { token: "q" },
    });
    await expect(
      db.workspaceLicense.upsert({
        where: { workspaceId: WS },
        create: { token: "p" },
        update: { workspaceId: "ws_b" } as never,
      }),
    ).rejects.toThrow(TenantViolation);
  });
});

describe("forTenant: actualizaciones", () => {
  it.each(["update", "updateMany", "updateManyAndReturn"] as const)(
    "%s no puede cambiar workspaceId",
    async (op) => {
      const { db, calls } = setup();
      await expect(
        call(db.membership[op], { where: { id: "m1" }, data: { workspaceId: "ws_b" } }),
      ).rejects.toThrow(TenantViolation);
      expect(calls).toHaveLength(0);
    },
  );

  it("el workspace no puede cambiar su id", async () => {
    const { db } = setup();
    await expect(db.workspace.update({ where: { id: WS }, data: { id: "otro" } })).rejects.toThrow(
      TenantViolation,
    );
  });
});

describe("forTenant: escrituras anidadas", () => {
  const nested = [
    "create",
    "connect",
    "connectOrCreate",
    "upsert",
    "set",
    "update",
    "delete",
    "disconnect",
    "createMany",
    "updateMany",
    "deleteMany",
  ];

  it.each(nested)("rechaza %s anidado en create", async (operator) => {
    const { db, calls } = setup();
    await expect(
      db.membership.create({
        data: { userId: "u", roleId: "r", role: { [operator]: {} } } as never,
      }),
    ).rejects.toThrow(/Escritura anidada/);
    expect(calls).toHaveLength(0);
  });

  it.each(nested)("rechaza %s anidado en update", async (operator) => {
    const { db } = setup();
    await expect(
      db.role.update({ where: { id: "r" }, data: { memberships: { [operator]: {} } } as never }),
    ).rejects.toThrow(/Escritura anidada/);
  });

  it("rechaza escrituras anidadas en upsert y createMany", async () => {
    const { db } = setup();
    await expect(
      db.workspaceLicense.upsert({
        where: { workspaceId: WS },
        create: {
          token: "p",
          workspace: { connect: {} },
        } as never,
        update: {},
      }),
    ).rejects.toThrow(/Escritura anidada/);
    await expect(
      db.role.createMany({
        data: [{ name: "x", base: "MEMBER", workspace: { connect: {} } }] as never,
      }),
    ).rejects.toThrow(/Escritura anidada/);
  });

  it("las columnas Json con objetos no son escrituras anidadas", async () => {
    const { db } = setup();
    await expect(
      db.auditLog.create({ data: { action: "a", metadata: { create: { x: 1 } } } }),
    ).resolves.toBeDefined();
  });
});

describe("forTenant: recorridos hacia modelos globales", () => {
  it("permite incluir campos escalares de un modelo global", async () => {
    const { db } = setup();
    await expect(
      db.membership.findMany({ include: { user: { select: { name: true, email: true } } } }),
    ).resolves.toBeDefined();
  });

  it.each([
    ["include", { include: { user: { include: { memberships: true } } } }],
    ["select", { select: { user: { select: { memberships: { select: { id: true } } } } } }],
    ["_count", { include: { user: { select: { _count: { select: { memberships: true } } } } } }],
    ["where", { where: { user: { memberships: { some: { workspaceId: "ws_b" } } } } }],
    [
      "where con NOT/OR",
      { where: { OR: [{ NOT: { user: { is: { sessions: { some: {} } } } } }] } },
    ],
    ["orderBy", { orderBy: { user: { memberships: { _count: "desc" } } } }],
  ])("rechaza %s que sigue relaciones desde User", async (_name, args) => {
    const { db, calls } = setup();
    await expect(db.membership.findMany(args as never)).rejects.toThrow(/es global/);
    expect(calls).toHaveLength(0);
  });

  it("permite relaciones entre modelos con tenant", async () => {
    const { db } = setup();
    await expect(
      db.role.findMany({
        include: {
          memberships: { include: { role: true } },
          _count: { select: { memberships: true } },
        },
        where: { memberships: { some: { status: "ACTIVE" } } },
      }),
    ).resolves.toBeDefined();
  });
});

describe("forTenant: superficie expuesta", () => {
  it("no expone modelos globales ni SQL en crudo", () => {
    const { db } = setup();
    const surface = db as unknown as Record<string, unknown>;
    expect(surface.user).toBeUndefined();
    expect(surface.session).toBeUndefined();
    expect(surface.$queryRaw).toBeUndefined();
    expect(surface.$executeRaw).toBeUndefined();
    expect(surface.$queryRawUnsafe).toBeUndefined();
    expect(surface.$executeRawUnsafe).toBeUndefined();
    // @ts-expect-error: TenantDb no tiene modelos globales.
    expect(db.user).toBeUndefined();
  });

  it("AuditLog es append-only y Workspace no se crea ni se borra", () => {
    const { db } = setup();
    const audit = db.auditLog as unknown as Record<string, unknown>;
    const workspace = db.workspace as unknown as Record<string, unknown>;
    for (const op of ["update", "updateMany", "delete", "deleteMany", "upsert"]) {
      expect(audit[op], op).toBeUndefined();
    }
    for (const op of ["create", "delete", "deleteMany", "upsert", "updateMany"]) {
      expect(workspace[op], op).toBeUndefined();
    }
  });

  it("es inmutable", () => {
    const { db } = setup();
    expect(Object.isFrozen(db)).toBe(true);
    expect(Object.isFrozen(db.role)).toBe(true);
  });

  it("devuelve promesas comunes, sin API fluida", () => {
    const { db } = setup();
    const result = db.membership.findUnique({ where: { id: "m1" } }) as unknown as Record<
      string,
      unknown
    >;
    expect(result).toBeInstanceOf(Promise);
    expect(result.role).toBeUndefined();
  });

  it("rechaza un workspaceId vacío", () => {
    const { client } = fakeClient();
    expect(() => forTenant(client, "")).toThrow(TenantViolation);
  });
});

describe("forTenant: transacciones", () => {
  it("el callback recibe un TenantDb del mismo workspace", async () => {
    const { db, calls } = setup();
    await db.$transaction(async (tx) => {
      expect(tx.workspaceId).toBe(WS);
      await tx.role.findMany();
    });
    expect(calls.map((c) => c.delegate)).toEqual(["$transaction", "role"]);
    expect(last(calls).args.where).toEqual({ workspaceId: WS });
  });

  it("el TenantDb de la transacción tampoco expone SQL en crudo ni el cliente base", async () => {
    const { db } = setup();
    await db.$transaction((tx) => {
      // @ts-expect-error: TenantDb no tiene SQL en crudo, tampoco dentro de una transacción.
      expect(tx.$queryRawUnsafe).toBeUndefined();
      // @ts-expect-error: idem $executeRawUnsafe.
      expect(tx.$executeRawUnsafe).toBeUndefined();
      const surface = tx as unknown as Record<string, unknown>;
      for (const key of ["$queryRaw", "$executeRaw", "$queryRawTyped", "user", "tx", "client"]) {
        expect(surface[key], key).toBeUndefined();
      }
      // Ninguna propiedad (ni con símbolo) guarda el cliente de transacción.
      expect(Reflect.ownKeys(tx).sort()).toEqual(
        [
          "$transaction",
          "approval",
          "auditLog",
          "bianFeedback",
          "bianLimit",
          "comment",
          "commentThread",
          "contentChunk",
          "contentChunkDirty",
          "controlledDocument",
          "department",
          "departmentMember",
          "documentType",
          "documentVersion",
          "documentVisit",
          "downloadToken",
          "externalIdentity",
          "fileText",
          "fileVersion",
          "importJob",
          "invitation",
          "membership",
          "mention",
          "node",
          "notification",
          "pageContent",
          "pageImage",
          "permission",
          "pinLogin",
          "pluginSecret",
          "pluginSetting",
          "qrCode",
          "readAcknowledgment",
          "readRequirement",
          "role",
          "sharedSeen",
          "space",
          "spaceUserState",
          "ssoFlow",
          "uploadReservation",
          "usageCounter",
          "usageCounterMember",
          "workspace",
          "workspaceEmail",
          "workspaceLicense",
          "zipExport",
          "workspaceId",
        ].sort(),
      );
      return Promise.resolve();
    });
  });

  it("transactionClientOf solo resuelve TenantDb de una transacción", async () => {
    const { client } = fakeClient();
    const db = forTenant(client, WS);
    expect(() => transactionClientOf(db)).toThrow(TenantViolation);
    await db.$transaction((tx) => {
      expect(transactionClientOf(tx)).toBe(client);
      return Promise.resolve();
    });
  });

  it("req.db (fuera de una transacción) tampoco expone SQL en crudo", () => {
    const { db } = setup();
    // @ts-expect-error: TenantDb no tiene SQL en crudo.
    expect(db.$queryRaw).toBeUndefined();
    expect(Reflect.ownKeys(db)).not.toContain("$queryRawUnsafe");
  });

  it("no permite transacciones anidadas", async () => {
    const { client } = fakeClient();
    const tx = { ...client, $transaction: undefined } as unknown as PrismaClient;
    await expect(forTenant(tx, WS).$transaction(() => Promise.resolve())).rejects.toThrow(
      TenantViolation,
    );
  });
});
