// Periods of periodic forms (modules/forms/periods.ts): which day belongs to which period, which days
// are due and the period before, across weeks, months and years.
import { describe, expect, it } from "vitest";
import { dayIn } from "../src/lib/time-zone.ts";
import {
  isDue,
  isoWeekday,
  periodOf,
  previousPeriod,
  startsOn,
  type Schedule,
} from "../src/modules/forms/periods.ts";

const weekdays: Schedule = { frequency: "daily", weekdays: [1, 2, 3, 4, 5] };
const weekly: Schedule = { frequency: "weekly", weekdays: [] };
const monthly: Schedule = { frequency: "monthly", weekdays: [] };

describe("períodos de un formulario periódico", () => {
  it("diario de lunes a viernes: el fin de semana no hay período", () => {
    expect(isoWeekday("2026-11-02")).toBe(1); // lunes
    expect(periodOf(weekdays, "2026-11-02")).toBe("2026-11-02");
    expect(periodOf(weekdays, "2026-11-07")).toBeNull(); // sábado
    expect(isDue(weekdays, "2026-11-08")).toBe(false);
    // The Monday's previous period is the Friday before.
    expect(previousPeriod(weekdays, "2026-11-02")).toBe("2026-10-30");
    expect(previousPeriod(weekdays, "2026-11-03")).toBe("2026-11-02");
    expect(previousPeriod({ frequency: "daily", weekdays: [] }, "2026-11-03")).toBeNull();
  });

  it("semanal: de lunes a domingo, la clave es el lunes, también al cambiar de año", () => {
    expect(periodOf(weekly, "2026-11-04")).toBe("2026-11-02");
    expect(periodOf(weekly, "2026-11-08")).toBe("2026-11-02");
    expect(periodOf(weekly, "2027-01-01")).toBe("2026-12-28");
    expect(startsOn(weekly, "2026-11-02")).toBe(true);
    expect(startsOn(weekly, "2026-11-03")).toBe(false);
    expect(previousPeriod(weekly, "2026-11-04")).toBe("2026-10-26");
  });

  it("mensual: la clave es el mes, y el anterior a enero es diciembre", () => {
    expect(periodOf(monthly, "2026-11-30")).toBe("2026-11");
    expect(startsOn(monthly, "2026-11-01")).toBe(true);
    expect(startsOn(monthly, "2026-11-02")).toBe(false);
    expect(previousPeriod(monthly, "2027-01-15")).toBe("2026-12");
    expect(previousPeriod(monthly, "2026-03-31")).toBe("2026-02");
  });

  it("el día es el de la empresa: la noche del domingo en Santiago ya es lunes en UTC", () => {
    const instant = new Date("2026-11-02T02:30:00Z"); // domingo 23:30 en Santiago (UTC-3)
    expect(periodOf(weekly, dayIn(instant, "America/Santiago"))).toBe("2026-10-26");
    expect(periodOf(weekly, dayIn(instant, "UTC"))).toBe("2026-11-02");
    // The night the clocks change in Madrid is still Sunday there.
    expect(dayIn(new Date("2026-10-25T21:30:00Z"), "Europe/Madrid")).toBe("2026-10-25");
  });

  it("sin periodicidad no hay nada que llenar", () => {
    const none: Schedule = { frequency: "none", weekdays: [] };
    expect(periodOf(none, "2026-11-02")).toBeNull();
    expect(startsOn(none, "2026-11-02")).toBe(false);
    expect(previousPeriod(none, "2026-11-02")).toBeNull();
  });
});
