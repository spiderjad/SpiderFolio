// Parte 1 del Módulo 2: el contexto de tenant trae los departamentos de la persona con sus ancestros.
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.ts";
import { createTestContext, createWorkspace, type TestContext } from "./helpers.ts";
import { bodyOf } from "../http.ts";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  await ctx.close();
});

describe("departmentIds en el contexto de tenant", () => {
  it("incluye los ancestros de cada departamento de la persona", async () => {
    const ws = await createWorkspace(ctx, "Planta con áreas");
    const { prisma } = ctx;
    const produccion = await prisma.department.create({
      data: { workspaceId: ws.workspaceId, name: "Producción" },
    });
    const lineas = await prisma.department.create({
      data: { workspaceId: ws.workspaceId, name: "Líneas", parentId: produccion.id },
    });
    const linea1 = await prisma.department.create({
      data: { workspaceId: ws.workspaceId, name: "Línea 1", parentId: lineas.id },
    });
    await prisma.department.create({ data: { workspaceId: ws.workspaceId, name: "Calidad" } });
    await prisma.departmentMember.create({
      data: {
        workspaceId: ws.workspaceId,
        departmentId: linea1.id,
        membershipId: ws.membershipId,
      },
    });

    const app = createApp(ctx.deps);
    const res = await request(app)
      .get(`/api/v1/w/${ws.slug}`)
      .set("Authorization", `Bearer ${ws.token}`);
    expect(res.status).toBe(200);
    const body = bodyOf(res);
    expect(body.membership.departmentIds.sort()).toEqual(
      [produccion.id, lineas.id, linea1.id].sort(),
    );
  });

  it("sin departamentos devuelve una lista vacía", async () => {
    const ws = await createWorkspace(ctx, "Sin áreas");
    const res = await request(createApp(ctx.deps))
      .get(`/api/v1/w/${ws.slug}`)
      .set("Authorization", `Bearer ${ws.token}`);
    expect(bodyOf(res).membership.departmentIds).toEqual([]);
  });

  it("la base impide un departamento padre de otro workspace", async () => {
    const a = await createWorkspace(ctx, "A con áreas");
    const b = await createWorkspace(ctx, "B con áreas");
    const deptoB = await ctx.prisma.department.create({
      data: { workspaceId: b.workspaceId, name: "Del otro" },
    });
    await expect(
      ctx.prisma.department.create({
        data: { workspaceId: a.workspaceId, name: "Hijo ajeno", parentId: deptoB.id },
      }),
    ).rejects.toThrow();
  });
});
