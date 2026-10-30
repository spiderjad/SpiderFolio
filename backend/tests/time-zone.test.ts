// The company's time zone (lib/time-zone.ts): days that never move, the clock changes and 8:00 local.
import { describe, expect, it } from "vitest";
import {
  dayIn,
  dayMonthsLater,
  endOfDayIn,
  formatDayIn,
  formatUtcDay,
  localHour,
  startOfDayIn,
  zoneOf,
} from "../src/lib/time-zone.ts";

describe("zona de la empresa", () => {
  it("una zona que falta o no existe es UTC", () => {
    expect(zoneOf({ timezone: "America/Santiago" })).toBe("America/Santiago");
    expect(zoneOf({})).toBe("UTC");
    expect(zoneOf({ timezone: "Marte/Olimpo" })).toBe("UTC");
    expect(zoneOf(null)).toBe("UTC");
  });
});

describe("las 8:00 de la empresa con cambios de horario", () => {
  const at = (iso: string) => new Date(iso);
  it.each([
    // Madrid: CET (UTC+1) en invierno, CEST (UTC+2) desde el 29/3/2026 y hasta el 25/10/2026.
    ["Europe/Madrid", "2026-03-28T07:00:00Z"],
    ["Europe/Madrid", "2026-03-29T06:00:00Z"],
    ["Europe/Madrid", "2026-10-25T07:00:00Z"],
    // Santiago: UTC-3 en verano austral, UTC-4 desde el 5/4/2026 y otra vez UTC-3 desde el 6/9/2026.
    ["America/Santiago", "2026-04-04T11:00:00Z"],
    ["America/Santiago", "2026-04-05T12:00:00Z"],
    ["America/Santiago", "2026-09-06T11:00:00Z"],
    // Ciudad de México ya no cambia de hora: siempre UTC-6.
    ["America/Mexico_City", "2026-04-05T14:00:00Z"],
    ["America/Mexico_City", "2026-11-01T14:00:00Z"],
    // Media hora y tres cuartos de hora.
    ["Asia/Kolkata", "2026-06-01T02:30:00Z"],
    ["Asia/Kathmandu", "2026-06-01T02:15:00Z"],
  ])("en %s, %s son las 8", (zone, instant) => {
    expect(localHour(at(instant), zone)).toBe(8);
    // Una hora antes todavía no: el job horario solo encuentra las 8 una vez por día.
    expect(localHour(new Date(at(instant).getTime() - 3_600_000), zone)).toBe(7);
  });

  it("en el día que se atrasa la hora, las 8 aparecen una sola vez", () => {
    // Las 24 horas UTC del 25/10 (de las 2:00 del 25 a la 1:00 del 26 en Madrid, que ese día tiene 25).
    const hours: number[] = [];
    for (let h = 0; h < 24; h++) {
      hours.push(localHour(new Date(Date.UTC(2026, 9, 25, h)), "Europe/Madrid"));
    }
    expect(hours.filter((hour) => hour === 8)).toHaveLength(1);
    expect(hours.filter((hour) => hour === 2)).toHaveLength(2);
  });
});

describe("fechas de día completo", () => {
  it("el fin del día en la zona, también el día que cambia la hora", () => {
    expect(endOfDayIn("2026-01-15", "Europe/Madrid").toISOString()).toBe(
      "2026-01-15T22:59:59.000Z",
    );
    expect(endOfDayIn("2026-07-15", "Europe/Madrid").toISOString()).toBe(
      "2026-07-15T21:59:59.000Z",
    );
    // Los días del cambio: a la noche ya rige el horario nuevo.
    expect(endOfDayIn("2026-03-29", "Europe/Madrid").toISOString()).toBe(
      "2026-03-29T21:59:59.000Z",
    );
    expect(endOfDayIn("2026-10-25", "Europe/Madrid").toISOString()).toBe(
      "2026-10-25T22:59:59.000Z",
    );
    expect(endOfDayIn("2026-04-05", "America/Santiago").toISOString()).toBe(
      "2026-04-06T03:59:59.000Z",
    );
    expect(endOfDayIn("2026-09-06", "America/Santiago").toISOString()).toBe(
      "2026-09-07T02:59:59.000Z",
    );
  });

  it.each(["Pacific/Kiritimati", "Etc/GMT+12", "Europe/Madrid", "America/Santiago", "UTC"])(
    "un día guardado en %s se lee ese mismo día en esa zona",
    (zone) => {
      for (const day of ["2026-01-01", "2026-03-29", "2026-10-25", "2026-12-31", "2028-02-29"]) {
        const end = endOfDayIn(day, zone);
        expect(dayIn(end, zone)).toBe(day);
        expect(formatDayIn(end, zone, "es")).toBe(formatUtcDay(new Date(`${day}T12:00:00Z`), "es"));
      }
    },
  );

  it("la próxima revisión cae el mismo día unos meses después, o el último del mes", () => {
    const zone = "America/Santiago";
    // Publicado el 31/1 a las 23:30 de Santiago (ya es 1/2 en UTC): revisión el 28/2.
    const published = new Date("2027-02-01T02:30:00Z");
    expect(dayIn(published, zone)).toBe("2027-01-31");
    expect(dayIn(dayMonthsLater(published, 1, zone), zone)).toBe("2027-02-28");
    expect(dayIn(dayMonthsLater(published, 12, zone), zone)).toBe("2028-01-31");
    expect(
      dayIn(dayMonthsLater(new Date("2026-03-29T10:00:00Z"), 6, "Europe/Madrid"), "Europe/Madrid"),
    ).toBe("2026-09-29");
  });

  it("un filtro «desde» empieza a las 0:00 de la empresa, también el día del cambio de hora", () => {
    expect(startOfDayIn("2026-03-29", "Europe/Madrid").toISOString()).toBe(
      "2026-03-28T23:00:00.000Z",
    );
    expect(startOfDayIn("2026-10-25", "Europe/Madrid").toISOString()).toBe(
      "2026-10-24T22:00:00.000Z",
    );
    expect(startOfDayIn("2026-09-06", "America/Santiago").toISOString()).toBe(
      "2026-09-06T04:00:00.000Z",
    );
    expect(startOfDayIn("2026-06-01", "UTC").toISOString()).toBe("2026-06-01T00:00:00.000Z");
  });

  it("una licencia hasta el 31/12 dice 31/12 en cualquier zona", () => {
    expect(formatUtcDay(new Date("2027-12-31T23:59:59Z"), "es")).toBe("31 de diciembre de 2027");
  });
});
