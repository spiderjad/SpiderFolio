import { describe, expect, it } from "vitest";
import {
  crossedThreshold,
  effectiveRemaining,
  personalRemaining,
  pickLimit,
  type LimitRow,
} from "../src/modules/bian/limits.core.ts";

const row = (r: Partial<LimitRow> & Pick<LimitRow, "scope" | "mode">): LimitRow => ({
  departmentId: null,
  membershipId: null,
  limit: null,
  ...r,
});

const person = (departments: string[] = []) => ({
  membershipId: "ana",
  departmentIds: new Set(departments),
});

describe("límites de Bian: precedencia", () => {
  const general = row({ scope: "GENERAL", mode: "LIMIT", limit: 10 });
  const sales = row({ scope: "DEPARTMENT", departmentId: "ventas", mode: "LIMIT", limit: 50 });
  const plant = row({ scope: "DEPARTMENT", departmentId: "planta", mode: "LIMIT", limit: 5 });
  const own = row({ scope: "PERSON", membershipId: "ana", mode: "LIMIT", limit: 100 });

  it("sin reglas no hay tope propio", () => {
    expect(pickLimit([], person())).toEqual({ mode: "UNLIMITED", limit: null, source: "none" });
  });

  it("persona > departamento > general", () => {
    expect(pickLimit([general, sales, own], person(["ventas"]))).toMatchObject({
      limit: 100,
      source: "person",
    });
    expect(pickLimit([general, sales], person(["ventas"]))).toMatchObject({
      limit: 50,
      source: "department",
    });
    expect(pickLimit([general, sales], person(["otra"]))).toMatchObject({
      limit: 10,
      source: "general",
    });
  });

  it("la excepción de la persona gana aunque sea menor, ilimitada o sin acceso", () => {
    const less = row({ scope: "PERSON", membershipId: "ana", mode: "LIMIT", limit: 1 });
    expect(pickLimit([general, sales, less], person(["ventas"]))).toMatchObject({ limit: 1 });
    const unlimited = row({ scope: "PERSON", membershipId: "ana", mode: "UNLIMITED" });
    expect(pickLimit([general, plant, unlimited], person(["planta"]))).toMatchObject({
      mode: "UNLIMITED",
      source: "person",
    });
    const blocked = row({ scope: "PERSON", membershipId: "ana", mode: "BLOCKED" });
    expect(pickLimit([general, sales, blocked], person(["ventas"]))).toMatchObject({
      mode: "BLOCKED",
    });
  });

  it("la regla de otra persona no cuenta; en dos departamentos vale la más generosa", () => {
    const other = row({ scope: "PERSON", membershipId: "beto", mode: "BLOCKED" });
    expect(pickLimit([general, other], person())).toMatchObject({ source: "general" });
    expect(pickLimit([general, sales, plant], person(["planta", "ventas"]))).toMatchObject({
      limit: 50,
    });
    const unlimitedDept = row({ scope: "DEPARTMENT", departmentId: "ventas", mode: "UNLIMITED" });
    expect(pickLimit([plant, unlimitedDept], person(["planta", "ventas"]))).toMatchObject({
      mode: "UNLIMITED",
    });
  });
});

describe("límites de Bian: dentro del total de la empresa", () => {
  it("lo que queda es el menor entre lo personal y lo de la empresa", () => {
    const personal = { mode: "LIMIT" as const, limit: 10, source: "general" as const };
    expect(personalRemaining(personal, 4)).toBe(6);
    // Personal 6, empresa 3: manda la empresa.
    expect(effectiveRemaining(personal, 4, { used: 97, total: 100 })).toBe(3);
    expect(effectiveRemaining(personal, 4, { used: 10, total: 100 })).toBe(6);
    // Sin tope personal: solo vale la empresa; sin tope de empresa: solo el personal.
    const free = { mode: "UNLIMITED" as const, limit: null, source: "none" as const };
    expect(effectiveRemaining(free, 50, { used: 99, total: 100 })).toBe(1);
    expect(effectiveRemaining(personal, 4, { used: 99, total: null })).toBe(6);
    expect(effectiveRemaining(free, 0, { used: 5, total: null })).toBeNull();
    expect(
      effectiveRemaining({ mode: "BLOCKED", limit: null, source: "person" }, 0, {
        used: 0,
        total: 100,
      }),
    ).toBe(0);
  });

  it("los umbrales de aviso se cruzan una sola vez", () => {
    expect(crossedThreshold(80, 100, 80)).toBe(true);
    expect(crossedThreshold(79, 100, 80)).toBe(false);
    expect(crossedThreshold(81, 100, 80)).toBe(false);
    expect(crossedThreshold(95, 100, 95)).toBe(true);
    expect(crossedThreshold(5, 5, 95)).toBe(true);
    expect(crossedThreshold(1, 0, 80)).toBe(false);
  });
});
