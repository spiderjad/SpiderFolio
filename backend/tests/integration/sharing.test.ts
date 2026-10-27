// Compartir y auditoría de accesos (módulo 5): quién puede dar, ver y auditar accesos, la herencia y
// los espacios confidenciales.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, createTestContext, type TestContext } from "./helpers.ts";
import { pagesWorld } from "./pages-world.ts";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  await ctx.close();
});

interface Explanation {
  inheritance: { inherits: boolean } | null;
  grants: { id: string; subject: { name: string }; level: string; from: unknown }[];
  people: { items: { membershipId: string; level: string }[]; total: number };
}

describe("quién accede y por qué", () => {
  it("solo quien gestiona lo ve, y coincide con lo que cada persona puede hacer", async () => {
    const w = await pagesWorld(ctx, "Explicación");
    // Quien edita, comenta o ve, no gestiona; quien no tiene acceso ni sabe que existe.
    for (const who of [w.editor, w.commenter, w.viewer]) {
      expect((await w.call("get", who.token, `/nodes/${w.pageId}/access`)).status).toBe(403);
      expect((await w.call("get", who.token, `/spaces/${w.spaceId}/access`)).status).toBe(403);
    }
    expect((await w.call("get", w.stranger.token, `/nodes/${w.pageId}/access`)).status).toBe(404);
    expect((await w.call("get", w.outsider.token, `/nodes/${w.pageId}/access`)).status).toBe(404);

    const res = await w.call("get", w.ws.token, `/nodes/${w.pageId}/access?pageSize=100`);
    expect(res.status).toBe(200);
    const body = res.body as Explanation;
    const level = (id: string) => body.people.items.find((p) => p.membershipId === id)?.level;
    expect(level(w.editor.membership.id)).toBe("EDIT");
    expect(level(w.commenter.membership.id)).toBe("COMMENT");
    expect(level(w.viewer.membership.id)).toBe("VIEW");
    expect(level(w.stranger.membership.id)).toBeUndefined();
    // Cada acceso dado en el espacio (los tres y el de quien lo creó) aparece como heredado.
    expect(body.grants.filter((g) => g.from !== null)).toHaveLength(4);
  });
});

describe("dar y quitar accesos", () => {
  it("solo quien gestiona da acceso; no se duplica y los lectores llegan hasta COMMENT", async () => {
    const w = await pagesWorld(ctx, "Dar accesos");
    const give = (token: string, body: object) =>
      w.call("put", token, `/nodes/${w.pageId}/permissions`, body);
    const sofia = w.stranger.membership.id;
    expect((await give(w.editor.token, { membershipId: sofia, level: "VIEW" })).status).toBe(403);
    expect((await give(w.stranger.token, { membershipId: sofia, level: "VIEW" })).status).toBe(404);
    expect((await give(w.outsider.token, { membershipId: sofia, level: "VIEW" })).status).toBe(404);
    expect(await ctx.prisma.permission.count({ where: { membershipId: sofia } })).toBe(0);

    expect((await give(w.ws.token, { membershipId: sofia, level: "VIEW" })).status).toBe(200);
    expect((await give(w.ws.token, { membershipId: sofia, level: "EDIT" })).status).toBe(200);
    expect(
      await ctx.prisma.permission.count({ where: { nodeId: w.pageId, membershipId: sofia } }),
    ).toBe(1);

    const reader = await addMember(ctx, w.ws, { name: "Lola Lectora", seatType: "READER" });
    for (const level of ["EDIT", "MANAGE"]) {
      expect((await give(w.ws.token, { membershipId: reader.membership.id, level })).status).toBe(
        400,
      );
    }
    // Una persona de otra empresa no existe para esta.
    expect(
      (await give(w.ws.token, { membershipId: w.outsider.membershipId, level: "VIEW" })).status,
    ).toBe(400);
  });

  it("nadie se quita a sí mismo el acceso que le permite gestionar", async () => {
    const w = await pagesWorld(ctx, "Sin quedarse afuera");
    const boss = await addMember(ctx, w.ws, { name: "Gabriel Gestor" });
    expect(
      (
        await w.call("put", w.ws.token, `/nodes/${w.pageId}/permissions`, {
          membershipId: boss.membership.id,
          level: "MANAGE",
        })
      ).status,
    ).toBe(200);
    const mine = await ctx.prisma.permission.findFirstOrThrow({
      where: { nodeId: w.pageId, membershipId: boss.membership.id },
    });
    expect((await w.call("delete", boss.token, `/permissions/${mine.id}`)).status).toBe(409);
    expect(
      (
        await w.call("put", boss.token, `/nodes/${w.pageId}/permissions`, {
          membershipId: boss.membership.id,
          level: "VIEW",
        })
      ).status,
    ).toBe(409);
    expect(await ctx.prisma.permission.count({ where: { id: mine.id, level: "MANAGE" } })).toBe(1);
    // Quien no gestiona no puede quitar el acceso de otro (ni sabiendo su id).
    const other = await ctx.prisma.permission.findFirstOrThrow({
      where: { spaceId: w.spaceId, membershipId: w.viewer.membership.id },
    });
    expect((await w.call("delete", w.editor.token, `/permissions/${other.id}`)).status).toBe(403);
    expect((await w.call("delete", w.outsider.token, `/permissions/${other.id}`)).status).toBe(404);
  });

  it("cortar la herencia deja afuera a quien llegaba por arriba, y quien corta conserva Gestionar", async () => {
    const w = await pagesWorld(ctx, "Herencia");
    const boss = await addMember(ctx, w.ws, { name: "Gabriel Gestor" });
    await ctx.prisma.permission.create({
      data: {
        workspaceId: w.ws.workspaceId,
        spaceId: w.spaceId,
        membershipId: boss.membership.id,
        level: "MANAGE",
        grantedById: w.ownerMembership.id,
      },
    });
    const patch = (token: string, inheritAccess: boolean) =>
      w.call("patch", token, `/nodes/${w.pageId}/inheritance`, { inheritAccess });
    expect((await patch(w.editor.token, false)).status).toBe(403);
    expect((await patch(w.stranger.token, false)).status).toBe(404);

    const cut = await patch(boss.token, false);
    expect(cut.status).toBe(200);
    expect(cut.body).toMatchObject({ inheritAccess: false, keptAccess: true });
    // Gabriel conserva el acceso, y los demás dejan de ver la página.
    expect((await w.call("get", boss.token, `/pages/${w.pageId}`)).status).toBe(200);
    expect((await w.call("get", w.viewer.token, `/pages/${w.pageId}`)).status).toBe(404);
    // El propietario no necesita un acceso directo.
    expect((await w.call("get", w.ws.token, `/pages/${w.pageId}`)).status).toBe(200);

    expect((await patch(boss.token, true)).status).toBe(200);
    expect((await w.call("get", w.viewer.token, `/pages/${w.pageId}`)).status).toBe(200);
  });
});

describe("auditoría de accesos", () => {
  it("pide la capacidad permissions.audit: ni un miembro ni quien gestiona un espacio la tienen", async () => {
    const w = await pagesWorld(ctx, "Auditoría permisos");
    const admin = await addMember(ctx, w.ws, { base: "ADMIN", name: "Ada Admin" });
    const paths = [
      "/admin/access/matrix",
      "/admin/access/targets?kind=space",
      `/admin/access/who?type=space&id=${w.spaceId}`,
      `/admin/access/who/export?type=space&id=${w.spaceId}`,
      `/admin/access/people/${w.viewer.membership.id}`,
      "/admin/access/reports/guests",
      "/admin/access/reports/expiring/export",
    ];
    for (const path of paths) {
      expect((await w.call("get", w.editor.token, path)).status, path).toBe(403);
      expect((await w.call("get", w.outsider.token, path)).status, path).toBe(404);
      expect((await w.call("get", admin.token, path)).status, path).toBe(200);
      expect((await w.call("get", w.ws.token, path)).status, path).toBe(200);
    }
    // El tipo de reporte se valida.
    expect((await w.call("get", admin.token, "/admin/access/reports/otro")).status).toBe(400);
  });

  it("los espacios confidenciales los audita solo el propietario", async () => {
    const w = await pagesWorld(ctx, "Auditoría confidencial");
    const admin = await addMember(ctx, w.ws, { base: "ADMIN", name: "Ada Admin" });
    const secret = await w.call("post", w.ws.token, "/spaces", {
      name: "Directorio",
      isPrivate: true,
      isConfidential: true,
    });
    expect(secret.status).toBe(201);
    const secretId = (secret.body as { space: { id: string } }).space.id;

    const who = `/admin/access/who?type=space&id=${secretId}`;
    expect((await w.call("get", admin.token, who)).status).toBe(404);
    expect((await w.call("get", w.ws.token, who)).status).toBe(200);
    const names = async (token: string) =>
      (
        (await w.call("get", token, "/admin/access/targets?kind=space&pageSize=100")).body as {
          items: { name: string }[];
        }
      ).items.map((i) => i.name);
    expect(await names(admin.token)).not.toContain("Directorio");
    expect(await names(w.ws.token)).toContain("Directorio");
    const matrix = async (token: string) =>
      (
        (await w.call("get", token, "/admin/access/matrix")).body as {
          spaces: { items: { name: string }[] };
        }
      ).spaces.items.map((s) => s.name);
    expect(await matrix(admin.token)).not.toContain("Directorio");
    expect(await matrix(w.ws.token)).toContain("Directorio");
  });

  it("no mezcla empresas, y el CSV neutraliza fórmulas y queda en la auditoría", async () => {
    const w = await pagesWorld(ctx, "Auditoría CSV");
    const other = await pagesWorld(ctx, "Auditoría CSV ajena");
    const folder = await w.call("post", w.ws.token, `/spaces/${w.spaceId}/folders`, {
      name: "=HYPERLINK(1)",
    });
    expect(folder.status).toBe(201);
    const folderId = (folder.body as { node: { id: string } }).node.id;
    expect(
      (
        await w.call("patch", w.ws.token, `/nodes/${folderId}/inheritance`, {
          inheritAccess: false,
        })
      ).status,
    ).toBe(200);

    const report = await w.call("get", w.ws.token, "/admin/access/reports/cut-inheritance");
    expect(
      (report.body as { items: { target: { name: string } }[] }).items.map((i) => i.target.name),
    ).toContain("=HYPERLINK(1)");
    const csv = await w.call("get", w.ws.token, "/admin/access/reports/cut-inheritance/export");
    expect(csv.status).toBe(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    const text = csv.text;
    expect(text).toContain("'=HYPERLINK(1)");
    expect(text).not.toMatch(/(^|,)=HYPERLINK/mu);
    expect(
      await ctx.prisma.auditLog.count({
        where: { workspaceId: w.ws.workspaceId, action: "access.report.export" },
      }),
    ).toBe(1);

    // Los reportes de una empresa no traen nada de la otra.
    const mine = (
      await w.call("get", w.ws.token, "/admin/access/reports/direct-people?pageSize=100")
    ).body as { items: { target: { spaceId: string } }[] };
    expect(mine.items.every((i) => i.target.spaceId === w.spaceId)).toBe(true);
    expect(
      (await w.call("get", w.ws.token, `/admin/access/who?type=space&id=${other.spaceId}`)).status,
    ).toBe(404);
  });
});
