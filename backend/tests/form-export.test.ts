// Records exported (docs/spec/formularios.md, phase 4): each answer as text with the labels of the
// version it was filled with, and the CSV columns across versions.
import { describe, expect, it } from "vitest";
import type { FormField } from "../src/modules/forms/forms.schemas.ts";
import { answerText, exportColumns } from "../src/modules/forms/records-export.ts";

const words = {
  yes: "Sí",
  no: "No",
  unchecked: (items: string) => `(sin marcar: ${items})`,
  photos: (count: number) => `${String(count)} fotos`,
  signed: "Firmado",
};

const field = (extra: object) => ({ id: "f", label: "F", required: false, ...extra }) as FormField;

describe("answerText", () => {
  it("escribe cada tipo de respuesta", () => {
    expect(answerText(field({ type: "number", unit: "°C" }), 3.5, words)).toBe("3.5 °C");
    expect(answerText(field({ type: "number" }), 0, words)).toBe("0");
    expect(answerText(field({ type: "yesno", nonConforming: null }), "no", words)).toBe("No");
    const options = [
      { id: "a", label: "Mañana" },
      { id: "b", label: "Tarde" },
    ];
    expect(answerText(field({ type: "choice", options, nonConforming: [] }), "b", words)).toBe(
      "Tarde",
    );
    expect(answerText(field({ type: "checklist", items: options }), ["a"], words)).toBe(
      "Mañana (sin marcar: Tarde)",
    );
    expect(answerText(field({ type: "checklist", items: options }), undefined, words)).toBe(
      "(sin marcar: Mañana; Tarde)",
    );
    expect(answerText(field({ type: "photo", max: 3 }), ["x", "y"], words)).toBe("2 fotos");
    expect(answerText(field({ type: "signature" }), "file1", words)).toBe("Firmado");
    expect(answerText(field({ type: "text", multiline: false }), undefined, words)).toBe("");
  });
});

describe("exportColumns", () => {
  it("primero los campos de la versión actual; los viejos que ya no están, al final", () => {
    const columns = exportColumns([
      {
        version: 1,
        fields: [
          field({ id: "a", label: "Viejo A", type: "date" }),
          field({ id: "b", label: "B", type: "date" }),
        ],
      },
      { version: 2, fields: [field({ id: "a", label: "Nuevo A", type: "date" })] },
    ]);
    expect(columns).toEqual([
      { id: "a", label: "Nuevo A" },
      { id: "b", label: "B" },
    ]);
  });
});
