import { describe, expect, it } from "vitest";
import { normalizePersonName } from "../src/lib/person-name.ts";

describe("normalizePersonName", () => {
  it("recorta y unifica espacios", () => {
    expect(normalizePersonName("  Ana   María \t Pérez ")).toBe("Ana María Pérez");
  });

  it("todo en minúsculas: mayúscula inicial y partículas en minúscula", () => {
    expect(normalizePersonName("maría del carmen de la torre")).toBe(
      "María del Carmen de la Torre",
    );
    expect(normalizePersonName("joan i pere van der berg")).toBe("Joan i Pere van Der Berg");
    expect(normalizePersonName("pedro y los lobos")).toBe("Pedro y los Lobos");
  });

  it("todo en mayúsculas: igual que minúsculas", () => {
    expect(normalizePersonName("JOSÉ DE LA CRUZ")).toBe("José de la Cruz");
    expect(normalizePersonName("ANA-MARÍA O'BRIEN")).toBe("Ana-María O'Brien");
  });

  it("una partícula al inicio lleva mayúscula", () => {
    expect(normalizePersonName("de la fuente")).toBe("De la Fuente");
    expect(normalizePersonName("VON NEUMANN")).toBe("Von Neumann");
  });

  it("mezcla de mayúsculas y minúsculas: se respeta tal cual", () => {
    expect(normalizePersonName("McDonald de la Vega")).toBe("McDonald de la Vega");
    expect(normalizePersonName("  mcDonald   DE la vega ")).toBe("mcDonald DE la vega");
    expect(normalizePersonName("Juan de Dios")).toBe("Juan de Dios");
  });

  it("sin letras o con una sola letra no rompe", () => {
    expect(normalizePersonName("  ")).toBe("");
    expect(normalizePersonName("x")).toBe("X");
    expect(normalizePersonName("12")).toBe("12");
  });
});
