import { describe, expect, it } from "vitest";
import {
  parentMapOf,
  withAncestors,
  withDescendants,
  wouldCreateCycle,
} from "../src/modules/departments/department-tree.ts";

// Producción
//  ├─ Líneas
//  │   └─ Línea 1
//  └─ Mantenimiento
// Calidad
const parents = parentMapOf([
  { id: "prod", parentId: null },
  { id: "lineas", parentId: "prod" },
  { id: "linea1", parentId: "lineas" },
  { id: "mant", parentId: "prod" },
  { id: "calidad", parentId: null },
]);

describe("jerarquía de departamentos", () => {
  it("agrega los ancestros de cada departamento, sin repetir", () => {
    expect(withAncestors(["linea1"], parents).sort()).toEqual(["linea1", "lineas", "prod"]);
    expect(withAncestors(["linea1", "mant"], parents).sort()).toEqual([
      "linea1",
      "lineas",
      "mant",
      "prod",
    ]);
    expect(withAncestors(["calidad"], parents)).toEqual(["calidad"]);
    expect(withAncestors([], parents)).toEqual([]);
  });

  it("agrega los descendientes", () => {
    expect(withDescendants(["prod"], parents).sort()).toEqual(["linea1", "lineas", "mant", "prod"]);
    expect(withDescendants(["calidad"], parents)).toEqual(["calidad"]);
  });

  it("detecta ciclos al mover un departamento", () => {
    expect(wouldCreateCycle("prod", "linea1", parents)).toBe(true);
    expect(wouldCreateCycle("prod", "prod", parents)).toBe(true);
    expect(wouldCreateCycle("lineas", "mant", parents)).toBe(false);
    expect(wouldCreateCycle("linea1", null, parents)).toBe(false);
    expect(wouldCreateCycle("calidad", "prod", parents)).toBe(false);
  });

  it("no se cuelga si la base tuviera un ciclo", () => {
    const broken = parentMapOf([
      { id: "a", parentId: "b" },
      { id: "b", parentId: "a" },
    ]);
    expect(withAncestors(["a"], broken).sort()).toEqual(["a", "b"]);
  });
});
