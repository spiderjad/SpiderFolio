import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  CursorQuerySchema,
  cursorPageOf,
  decodeCursor,
  encodeCursor,
  MAX_PAGE_SIZE,
  offsetArgs,
  pageOf,
  pageShape,
  stableOrder,
} from "../src/lib/pagination.ts";

const Query = z.object(pageShape(["name", "createdAt"], "name"));

describe("pageShape", () => {
  it("por defecto: página 1, 25 por página, orden por el campo indicado ascendente", () => {
    expect(Query.parse({})).toEqual({ page: 1, pageSize: 25, sort: "name", dir: "asc" });
  });

  it("convierte los números de la URL y valida los límites", () => {
    expect(Query.parse({ page: "3", pageSize: "100", dir: "desc" })).toMatchObject({
      page: 3,
      pageSize: 100,
      dir: "desc",
    });
    for (const bad of [
      { page: "0" },
      { page: "10001" },
      { pageSize: "0" },
      { pageSize: String(MAX_PAGE_SIZE + 1) },
      { pageSize: "abc" },
      { sort: "passwordHash" },
      { dir: "sideways" },
    ]) {
      expect(Query.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("permite otro tamaño de página por defecto", () => {
    const query = z.object(pageShape(["name"], "name", { defaultPageSize: 10 }));
    expect(query.parse({}).pageSize).toBe(10);
  });
});

describe("offset", () => {
  it("calcula skip y take de la página pedida", () => {
    expect(offsetArgs({ page: 1, pageSize: 25 })).toEqual({ skip: 0, take: 25 });
    expect(offsetArgs({ page: 4, pageSize: 10 })).toEqual({ skip: 30, take: 10 });
  });

  it("arma la página con el total", () => {
    expect(pageOf(["a"], 11, { page: 2, pageSize: 10 })).toEqual({
      items: ["a"],
      total: 11,
      page: 2,
      pageSize: 10,
      nextCursor: null,
    });
  });

  it("el orden siempre termina en el id", () => {
    expect(stableOrder({ name: "asc" })).toEqual([{ name: "asc" }, { id: "asc" }]);
    expect(stableOrder([{ a: "asc" }, { b: "desc" }])).toEqual([
      { a: "asc" },
      { b: "desc" },
      { id: "asc" },
    ]);
  });
});

describe("cursor", () => {
  it("ida y vuelta, y un cursor inválido cuenta como la primera página", () => {
    const cursor = encodeCursor({ v: "2026-10-20T08:00:00.000Z", id: "abc" });
    expect(decodeCursor(cursor)).toEqual({ v: "2026-10-20T08:00:00.000Z", id: "abc" });
    expect(decodeCursor(undefined)).toBeNull();
    expect(decodeCursor("")).toBeNull();
    expect(decodeCursor("no-es-un-cursor")).toBeNull();
    expect(
      decodeCursor(Buffer.from('{"v":1,"id":"x","extra":1}').toString("base64url")),
    ).toBeNull();
    expect(decodeCursor(Buffer.from('{"v":{},"id":"x"}').toString("base64url"))).toBeNull();
  });

  it("limit va de 1 a 100 y por defecto es 25", () => {
    expect(CursorQuerySchema.parse({}).limit).toBe(25);
    expect(CursorQuerySchema.safeParse({ limit: "101" }).success).toBe(false);
    expect(CursorQuerySchema.safeParse({ limit: "0" }).success).toBe(false);
  });

  it("la consulta pide una fila de más: con ella hay otra página y el cursor apunta al último devuelto", () => {
    const rows = [1, 2, 3].map((n) => ({ id: `id${String(n)}`, n }));
    const first = cursorPageOf(rows, 2, (row) => ({ v: row.n, id: row.id }));
    expect(first.items).toHaveLength(2);
    expect(decodeCursor(first.nextCursor ?? "")).toEqual({ v: 2, id: "id2" });
    const last = cursorPageOf(rows.slice(0, 2), 2, (row) => ({ v: row.n, id: row.id }));
    expect(last).toMatchObject({ nextCursor: null });
    expect(cursorPageOf([], 2, () => ({ v: 0, id: "x" }))).toEqual({ items: [], nextCursor: null });
  });
});
