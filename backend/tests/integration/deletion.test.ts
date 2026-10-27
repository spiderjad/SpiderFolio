// Borrado de cuentas y de workspaces (RGPD, CLAUDE.md sección 12): tiene que funcionar con
// registros de auditoría, y el trigger append-only de AuditLog (que rechaza UPDATE) no puede
// impedirlo. Por eso ninguna FK de AuditLog puede ser ON DELETE SET NULL (sería un UPDATE).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { forTenant } from "../../src/db/tenant.ts";
import { audit, auditGlobal } from "../../src/modules/audit/audit.service.ts";
import { createTestContext, createUser, createWorkspace, type TestContext } from "./helpers.ts";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  await ctx.close();
});

describe("claves foráneas", () => {
  it("ninguna FK del schema usa ON DELETE SET NULL ni SET DEFAULT", async () => {
    const rows = await ctx.prisma.$queryRawUnsafe<{ tabla: string; accion: string }[]>(
      `SELECT conrelid::regclass::text AS tabla, confdeltype::text AS accion
       FROM pg_constraint
       WHERE contype = 'f' AND connamespace = 'public'::regnamespace`,
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.filter((r) => r.accion === "n" || r.accion === "d")).toEqual([]);
  });

  it("AuditLog solo referencia a Workspace, con CASCADE", async () => {
    const rows = await ctx.prisma.$queryRawUnsafe<{ referencia: string; accion: string }[]>(
      `SELECT confrelid::regclass::text AS referencia, confdeltype::text AS accion
       FROM pg_constraint
       WHERE contype = 'f' AND conrelid = '"AuditLog"'::regclass`,
    );
    expect(rows).toEqual([{ referencia: '"Workspace"', accion: "c" }]);
  });
});

describe("borrado de un usuario (cuenta)", () => {
  it("funciona aunque tenga auditoría, sesiones y membresías; la auditoría queda", async () => {
    const ws = await createWorkspace(ctx, "Borrado de cuenta");
    const db = forTenant(ctx.prisma, ws.workspaceId);
    const member = await createUser(ctx.prisma, "Persona que se va");
    const role = await db.role.findFirstOrThrow({ where: { base: "MEMBER" } });
    await db.membership.create({ data: { userId: member.id, roleId: role.id } });
    await ctx.prisma.session.create({
      data: {
        userId: member.id,
        familyId: "f",
        familyCreatedAt: new Date(),
        tokenHash: `borrado-${member.id}`,
        expiresAt: new Date(Date.now() + 3600_000),
      },
    });
    await audit(db, { actorId: member.id, action: "node.view" });
    await auditGlobal(ctx.prisma, { actorId: member.id, action: "auth.login" });

    await ctx.prisma.user.delete({ where: { id: member.id } });

    expect(await ctx.prisma.user.findUnique({ where: { id: member.id } })).toBeNull();
    expect(await ctx.prisma.session.count({ where: { userId: member.id } })).toBe(0);
    expect(await db.membership.count({ where: { userId: member.id } })).toBe(0);
    // La evidencia se conserva: actorId es un id seudónimo, sin FK.
    expect(await ctx.prisma.auditLog.count({ where: { actorId: member.id } })).toBe(2);
  });
});

describe("borrado de un workspace (purga)", () => {
  it("borra en cascada roles, membresías, suscripción y su auditoría", async () => {
    const ws = await createWorkspace(ctx, "Purga completa");
    const db = forTenant(ctx.prisma, ws.workspaceId);
    await audit(db, { actorId: ws.owner.id, action: "workspace.settings" });
    await auditGlobal(ctx.prisma, { action: "auth.login.failure" });
    expect(await db.auditLog.count()).toBeGreaterThanOrEqual(2);

    await ctx.prisma.workspace.delete({ where: { id: ws.workspaceId } });

    const where = { workspaceId: ws.workspaceId };
    expect(await ctx.prisma.role.count({ where })).toBe(0);
    expect(await ctx.prisma.membership.count({ where })).toBe(0);
    expect(await ctx.prisma.auditLog.count({ where })).toBe(0);
    // Los eventos globales (sin workspace) no se tocan.
    expect(
      await ctx.prisma.auditLog.count({
        where: { action: "auth.login.failure", workspaceId: null },
      }),
    ).toBeGreaterThanOrEqual(1);
    // El dueño sigue existiendo: su cuenta no depende del workspace.
    expect(await ctx.prisma.user.findUnique({ where: { id: ws.owner.id } })).not.toBeNull();
  });

  it("borrar al usuario dueño y después el workspace también funciona", async () => {
    const ws = await createWorkspace(ctx, "Dueño y workspace");
    await ctx.prisma.user.delete({ where: { id: ws.owner.id } });
    await ctx.prisma.workspace.delete({ where: { id: ws.workspaceId } });
    expect(await ctx.prisma.workspace.findUnique({ where: { id: ws.workspaceId } })).toBeNull();
  });

  it("borrar un rol en uso sigue fallando (FK NO ACTION)", async () => {
    const ws = await createWorkspace(ctx, "Rol en uso");
    const db = forTenant(ctx.prisma, ws.workspaceId);
    const owner = await db.role.findFirstOrThrow({ where: { base: "OWNER" } });
    await expect(db.role.delete({ where: { id: owner.id } })).rejects.toMatchObject({
      code: "P2003",
    });
  });

  it("el trigger sigue impidiendo modificar la auditoría", async () => {
    const ws = await createWorkspace(ctx, "Auditoría intacta");
    const log = await forTenant(ctx.prisma, ws.workspaceId).auditLog.findFirstOrThrow();
    await expect(
      ctx.prisma.auditLog.update({ where: { id: log.id }, data: { actorId: null } }),
    ).rejects.toThrow(/inmutable/);
  });
});
