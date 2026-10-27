// Paginación por cursor en las listas (CLAUDE.md, regla de paginación): se recorre toda la lista
// siguiendo nextCursor, sin repetir ni saltear a nadie, y un cursor inválido es 400.
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.ts";
import { addMember, createTestContext, createWorkspace, type TestContext } from "./helpers.ts";

let ctx: TestContext;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  ctx = await createTestContext();
  app = createApp(ctx.deps);
});

afterAll(async () => {
  await ctx.close();
});

interface Page {
  items: { id: string; name: string }[];
  total: number;
  nextCursor: string | null;
}

describe("cursor en el listado de miembros", () => {
  it("recorre todos con nextCursor, sin repetir, y termina en null", async () => {
    const ws = await createWorkspace(ctx, "Cursor miembros");
    for (let i = 0; i < 11; i++)
      await addMember(ctx, ws, { name: `Persona ${String(i).padStart(2, "0")}` });
    const get = async (query: string) =>
      await request(app)
        .get(`/api/v1/w/${ws.slug}/admin/members?${query}`)
        .set("Authorization", `Bearer ${ws.token}`);

    const seen: string[] = [];
    let cursor: string | null = null;
    let requests = 0;
    do {
      const res = await get(
        `pageSize=5&sort=name${cursor === null ? "" : `&cursor=${encodeURIComponent(cursor)}`}`,
      );
      expect(res.status).toBe(200);
      const body = res.body as Page;
      expect(body.total).toBe(12);
      seen.push(...body.items.map((m) => m.id));
      cursor = body.nextCursor;
      requests += 1;
    } while (cursor !== null && requests < 10);

    expect(requests).toBe(3);
    expect(seen).toHaveLength(12);
    expect(new Set(seen).size).toBe(12);

    const bad = await get("cursor=basura");
    expect(bad.status).toBe(400);
  });
});
