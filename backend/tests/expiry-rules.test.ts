// Expiry rules (docs/spec/seguridad-salud.md, «Motor de vencimientos»): days, state and thresholds.
import { describe, expect, it } from "vitest";
import {
  cleanNoticeDays,
  daysUntil,
  expiryState,
  noticeFor,
} from "../src/modules/expiries/expiry-rules.ts";

describe("vencimientos", () => {
  it("cuenta días entre días de la empresa, también con cambio de mes y de año", () => {
    expect(daysUntil("2026-11-02", "2026-11-09")).toBe(7);
    expect(daysUntil("2026-12-30", "2027-01-02")).toBe(3);
    expect(daysUntil("2026-03-28", "2026-03-30")).toBe(2);
    expect(daysUntil("2026-11-02", "2026-11-01")).toBe(-1);
  });

  it("vigente, por vencer (desde el mayor umbral, también el mismo día) o vencido", () => {
    expect(expiryState("2026-11-02", "2026-12-15", [30, 7, 0])).toBe("valid");
    expect(expiryState("2026-11-02", "2026-12-02", [30, 7, 0])).toBe("due_soon");
    expect(expiryState("2026-11-02", "2026-11-02", [30, 7, 0])).toBe("due_soon");
    expect(expiryState("2026-11-02", "2026-11-01", [30, 7, 0])).toBe("expired");
    expect(expiryState("2026-11-02", "2026-11-02", [])).toBe("due_soon");
  });

  it("un aviso por umbral alcanzado; los ya avisados no se repiten y uno saltado se junta", () => {
    expect(noticeFor(40, [30, 7, 0], [])).toEqual({ notify: false, sent: [] });
    expect(noticeFor(30, [30, 7, 0], [])).toEqual({ notify: true, sent: [30] });
    expect(noticeFor(20, [30, 7, 0], [30])).toEqual({ notify: false, sent: [30] });
    expect(noticeFor(5, [30, 7, 0], [30])).toEqual({ notify: true, sent: [30, 7] });
    // Created already expired: one notice for all of them.
    expect(noticeFor(-2, [30, 7, 0], [])).toEqual({ notify: true, sent: [30, 7, 0] });
    expect(noticeFor(-3, [30, 7, 0], [30, 7, 0])).toEqual({ notify: false, sent: [30, 7, 0] });
  });

  it("limpia los días de aviso", () => {
    expect(cleanNoticeDays([7, 30, 7, -1, 0, 400, 1.5])).toEqual([30, 7, 0]);
  });
});
