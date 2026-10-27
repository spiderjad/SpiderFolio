import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  decodeOffsetCursor,
  encodeOffsetCursor,
  nextOffsetCursor,
  offsetArgs,
  pageOf,
  pageShape,
} from "../src/lib/pagination.ts";

const Query = z.object(pageShape(["name"], "name"));

describe("cursor de posición", () => {
  it("ida y vuelta, y un cursor inválido no se acepta", () => {
    expect(decodeOffsetCursor(encodeOffsetCursor(75))).toBe(75);
    expect(decodeOffsetCursor("no-es-un-cursor")).toBeNull();
    expect(decodeOffsetCursor(Buffer.from('{"o":-1}').toString("base64url"))).toBeNull();
    expect(decodeOffsetCursor(Buffer.from('{"o":1,"x":2}').toString("base64url"))).toBeNull();
    expect(Query.safeParse({ cursor: "basura" }).success).toBe(false);
    expect(Query.safeParse({ cursor: encodeOffsetCursor(25) }).success).toBe(true);
  });

  it("el cursor manda sobre la página: salta lo ya entregado", () => {
    const query = Query.parse({ cursor: encodeOffsetCursor(50), pageSize: "25" });
    expect(offsetArgs(query)).toEqual({ skip: 50, take: 25 });
    expect(Query.parse({ page: "3" })).toMatchObject({ page: 3 });
    expect(offsetArgs(Query.parse({ page: "3" }))).toEqual({ skip: 50, take: 25 });
  });

  it("pageOf devuelve el cursor de la página siguiente, y null en la última", () => {
    const first = Query.parse({ pageSize: "2" });
    const page1 = pageOf(["a", "b"], 5, first);
    expect(page1.nextCursor).toBe(encodeOffsetCursor(2));
    const second = Query.parse({ pageSize: "2", cursor: page1.nextCursor ?? "" });
    const page2 = pageOf(["c", "d"], 5, second);
    expect(page2).toMatchObject({ total: 5, page: 2, nextCursor: encodeOffsetCursor(4) });
    const third = Query.parse({ pageSize: "2", cursor: page2.nextCursor ?? "" });
    expect(pageOf(["e"], 5, third).nextCursor).toBeNull();
    expect(nextOffsetCursor(0, 0, 0)).toBeNull();
  });
});
