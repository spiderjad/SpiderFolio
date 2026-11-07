// Accident rates (docs/spec/seguridad-salud.md, «Indicadores de siniestralidad»): the INSST formulas,
// pure functions. Without a denominator the index is unknown (null), never 0.
import { describe, expect, it } from "vitest";
import {
  addMonths,
  frequencyIndex,
  incidenceIndex,
  indicesOf,
  roundIndex,
  severityIndex,
  totalsOf,
} from "../src/modules/safety/indicators.ts";

describe("índices de siniestralidad", () => {
  it("frecuencia = accidentes con baja × 10⁶ / horas", () => {
    expect(frequencyIndex(3, 120_000)).toBe(25);
    expect(frequencyIndex(1, 70_000)).toBe(14.29);
    expect(frequencyIndex(0, 70_000)).toBe(0);
  });

  it("gravedad = días de baja × 10³ / horas", () => {
    expect(severityIndex(45, 120_000)).toBe(0.38);
    expect(severityIndex(0, 120_000)).toBe(0);
  });

  it("incidencia = accidentes con baja × 10⁵ / plantilla media", () => {
    expect(incidenceIndex(2, 40)).toBe(5000);
    expect(incidenceIndex(1, 3)).toBe(33333.33);
  });

  it("sin horas o plantilla (o con cero) el índice es nulo, no 0", () => {
    expect(frequencyIndex(2, null)).toBeNull();
    expect(frequencyIndex(2, 0)).toBeNull();
    expect(severityIndex(10, null)).toBeNull();
    expect(incidenceIndex(2, null)).toBeNull();
    expect(incidenceIndex(2, 0)).toBeNull();
    expect(indicesOf({ hours: null, headcount: null, accidents: 4, lostDays: 9 })).toEqual({
      frequency: null,
      severity: null,
      incidence: null,
    });
  });

  it("redondea a dos decimales", () => {
    expect(roundIndex(1.005)).toBeCloseTo(1, 2);
    expect(roundIndex(2.345678)).toBe(2.35);
  });
});

describe("totales de un periodo", () => {
  it("suma horas, accidentes y días; la plantilla es la media de los meses con dato", () => {
    const totals = totalsOf([
      { hours: 6000, headcount: 40, accidents: 1, lostDays: 10 },
      { hours: null, headcount: null, accidents: 1, lostDays: 3 },
      { hours: 6400, headcount: 42, accidents: 0, lostDays: 0 },
    ]);
    expect(totals).toEqual({ hours: 12_400, headcount: 41, accidents: 2, lostDays: 13 });
  });

  it("sin ningún mes con horas o plantilla quedan nulos", () => {
    expect(totalsOf([{ hours: null, headcount: null, accidents: 2, lostDays: 5 }])).toEqual({
      hours: null,
      headcount: null,
      accidents: 2,
      lostDays: 5,
    });
    expect(totalsOf([])).toEqual({ hours: null, headcount: null, accidents: 0, lostDays: 0 });
  });

  it("addMonths cruza años en los dos sentidos", () => {
    expect(addMonths("2026-11-01", 3)).toBe("2027-02-01");
    expect(addMonths("2026-01-01", -1)).toBe("2025-12-01");
    expect(addMonths("2026-03-01", -11)).toBe("2025-04-01");
  });
});
