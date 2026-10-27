// forTenant contra Postgres real, con dos workspaces A y B (CLAUDE.md, sección 7.4).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { forTenant, TenantViolation, type TenantDb } from "../../src/db/tenant.ts";
import { createTestContext, createUser, createWorkspace, type TestContext } from "./helpers.ts";

let ctx: TestContext;
let a: Awaited<ReturnType<typeof createWorkspace>>;
let b: Awaited<ReturnType<typeof createWorkspace>>;
let dbA: TenantDb;
let roleB: { id: string };
let membershipB: { id: string };

beforeAll(async () => {
  ctx = await createTestContext();
  a = await createWorkspace(ctx, "Empresa A");
  b = await createWorkspace(ctx, "Empresa B");
  dbA = forTenant(ctx.prisma, a.workspaceId);
  roleB = await ctx.prisma.role.findFirstOrThrow({
    where: { workspaceId: b.workspaceId, base: "MEMBER" },
  });
  membershipB = { id: b.membershipId };
});

afterAll(async () => {
  await ctx.close();
});

describe("lecturas de A no ven datos de B", () => {
  it("findUnique por id de B devuelve null", async () => {
    expect(await dbA.role.findUnique({ where: { id: roleB.id } })).toBeNull();
    expect(await dbA.membership.findUnique({ where: { id: membershipB.id } })).toBeNull();
    expect(await dbA.workspace.findUnique({ where: { id: b.workspaceId } })).toBeNull();
    expect(
      await dbA.workspaceLicense.findUnique({ where: { workspaceId: b.workspaceId } }),
    ).toBeNull();
  });

  it("findMany, count, aggregate y groupBy solo cuentan lo de A", async () => {
    const roles = await dbA.role.findMany();
    expect(roles).toHaveLength(4);
    expect(roles.every((r) => r.workspaceId === a.workspaceId)).toBe(true);
    expect(await dbA.role.count({ where: { id: { in: [roleB.id] } } })).toBe(0);
    const agg = await dbA.membership.aggregate({ _count: { _all: true } });
    expect(agg._count._all).toBe(1);
    const groups = await dbA.role.groupBy({ by: ["workspaceId"], _count: { _all: true } });
    expect(groups).toEqual([{ workspaceId: a.workspaceId, _count: { _all: 4 } }]);
  });

  it("findUniqueOrThrow de B falla como no encontrado", async () => {
    await expect(dbA.role.findUniqueOrThrow({ where: { id: roleB.id } })).rejects.toMatchObject({
      code: "P2025",
    });
  });
});

describe("escrituras de A no tocan datos de B", () => {
  it("update y delete por id de B fallan con P2025 y B queda igual", async () => {
    await expect(
      dbA.role.update({ where: { id: roleB.id }, data: { description: "hackeado" } }),
    ).rejects.toMatchObject({ code: "P2025" });
    await expect(dbA.role.delete({ where: { id: roleB.id } })).rejects.toMatchObject({
      code: "P2025",
    });
    const intact = await ctx.prisma.role.findUniqueOrThrow({ where: { id: roleB.id } });
    expect(intact.description).not.toBe("hackeado");
  });

  it("updateMany y deleteMany no afectan a B", async () => {
    const updated = await dbA.membership.updateMany({
      where: { id: membershipB.id },
      data: { jobTitle: "x" },
    });
    expect(updated.count).toBe(0);
    const deleted = await dbA.role.deleteMany({ where: { id: roleB.id } });
    expect(deleted.count).toBe(0);
  });

  it("upsert sobre la licencia de B no la modifica (crea o falla en A)", async () => {
    await ctx.prisma.workspaceLicense.upsert({
      where: { workspaceId: b.workspaceId },
      create: { workspaceId: b.workspaceId, token: "SFL1.licencia-de-b" },
      update: { token: "SFL1.licencia-de-b" },
    });
    await dbA.workspaceLicense
      .upsert({
        where: { workspaceId: b.workspaceId },
        create: { token: "SFL1.ajena" },
        update: { token: "SFL1.ajena" },
      })
      .catch(() => null);
    const licenseB = await ctx.prisma.workspaceLicense.findUniqueOrThrow({
      where: { workspaceId: b.workspaceId },
    });
    expect(licenseB.token).toBe("SFL1.licencia-de-b");
  });

  it("createMany crea en A aunque los datos no digan workspace", async () => {
    await dbA.role.createMany({
      data: [{ name: `Rol ${String(Date.now())}`, base: "MEMBER" }],
    });
    expect(await dbA.role.count()).toBe(5);
  });
});

describe("la base impide referencias cruzadas (FK compuestas)", () => {
  it("una membresía de A no puede usar un rol de B, ni con forTenant ni con el cliente base", async () => {
    const other = await createUser(ctx.prisma);
    await expect(
      dbA.membership.create({ data: { userId: other.id, roleId: roleB.id } }),
    ).rejects.toMatchObject({ code: "P2003" });
    await expect(
      ctx.prisma.membership.update({
        where: { id: a.membershipId },
        data: { roleId: roleB.id },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
  });
});

describe("recorridos y SQL en crudo", () => {
  it("rechaza recorrer membership → user → memberships (otros workspaces)", async () => {
    await expect(
      dbA.membership.findMany({ include: { user: { include: { memberships: true } } } }),
    ).rejects.toThrow(TenantViolation);
  });

  it("include de escalares de User funciona", async () => {
    const rows = await dbA.membership.findMany({ include: { user: { select: { name: true } } } });
    expect(rows[0]?.user.name).toContain("Empresa A");
  });

  it("no hay SQL en crudo en el cliente de tenant", () => {
    expect((dbA as unknown as Record<string, unknown>).$queryRawUnsafe).toBeUndefined();
  });
});

describe("transacciones", () => {
  it("dentro de $transaction sigue filtrando y revierte todo si falla", async () => {
    const before = await dbA.role.count();
    await expect(
      dbA.$transaction(async (tx) => {
        await tx.role.create({ data: { name: "Temporal", base: "MEMBER" } });
        expect(await tx.role.findUnique({ where: { id: roleB.id } })).toBeNull();
        throw new Error("revertir");
      }),
    ).rejects.toThrow("revertir");
    expect(await dbA.role.count()).toBe(before);
  });
});

describe("inmutabilidad en la base", () => {
  it("AuditLog no admite UPDATE (trigger)", async () => {
    const log = await dbA.auditLog.findFirstOrThrow();
    await expect(
      ctx.prisma.auditLog.update({ where: { id: log.id }, data: { action: "otra" } }),
    ).rejects.toThrow(/inmutable/);
  });
});
