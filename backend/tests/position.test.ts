import { describe, expect, it } from "vitest";
import { cleanName, nameKeyOf, NodeNameSchema, numberedName } from "../src/lib/names.ts";
import { positionBetween } from "../src/lib/position.ts";

describe("positionBetween", () => {
  it("genera claves que ordenan antes, entre y después", () => {
    const first = positionBetween(null, null);
    const after = positionBetween(first, null);
    const before = positionBetween(null, first);
    const between = positionBetween(first, after);
    expect([before, first, between, after].sort()).toEqual([before, first, between, after]);
    expect(new Set([before, first, between, after]).size).toBe(4);
  });

  it("aguanta muchas inserciones seguidas en el mismo hueco", () => {
    let low = positionBetween(null, null);
    const high = positionBetween(low, null);
    for (let i = 0; i < 200; i++) {
      const next = positionBetween(low, high);
      expect(next > low && next < high).toBe(true);
      low = next;
    }
  });

  it("aguanta muchas inserciones al principio y al final", () => {
    let head = positionBetween(null, null);
    let tail = head;
    for (let i = 0; i < 100; i++) {
      const before = positionBetween(null, head);
      expect(before < head).toBe(true);
      head = before;
      const after = positionBetween(tail, null);
      expect(after > tail).toBe(true);
      tail = after;
    }
    expect(head < tail).toBe(true);
  });

  it("rechaza extremos desordenados", () => {
    expect(() => positionBetween("b", "a")).toThrow();
    expect(() => positionBetween("a", "a")).toThrow();
  });
});

describe("nombres", () => {
  it("comparan sin distinguir mayúsculas y con NFC", () => {
    // "é" compuesta frente a "e" + acento combinado.
    expect(nameKeyOf("Café")).toBe(nameKeyOf("Café"));
    expect(nameKeyOf("  INFORME   Final ")).toBe("informe final");
    expect(cleanName("  a   b ")).toBe("a b");
  });

  it("rechazan barras, controles y nombres reservados", () => {
    for (const bad of ["", "   ", "a/b", "a\b", "a\u0000b", ".", "..", "x".repeat(256)]) {
      expect(NodeNameSchema.safeParse(bad).success, bad).toBe(false);
    }
    expect(NodeNameSchema.parse("  Procedimientos  ")).toBe("Procedimientos");
  });

  it("numeran conservando la extensión", () => {
    expect(numberedName("Informe.pdf", 2)).toBe("Informe (2).pdf");
    expect(numberedName("Carpeta", 3)).toBe("Carpeta (3)");
    expect(numberedName(".env", 2)).toBe(".env (2)");
  });
});
