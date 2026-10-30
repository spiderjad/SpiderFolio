// A record's answers (modules/forms/answers.ts): each type checked, the required ones, and what's
// non-conforming.
import { describe, expect, it } from "vitest";
import { checkAnswers } from "../src/modules/forms/answers.ts";
import { FieldsSchema } from "../src/modules/forms/forms.schemas.ts";

const fields = FieldsSchema.parse([
  { id: "temp", type: "number", label: "Temperatura", unit: "°C", min: 0, max: 4, required: true },
  { id: "door", type: "yesno", label: "¿Cierra la puerta?", nonConforming: "no" },
  {
    id: "floor",
    type: "choice",
    label: "Suelo",
    options: [
      { id: "clean", label: "Limpio" },
      { id: "dirty", label: "Sucio" },
    ],
    nonConforming: ["dirty"],
  },
  {
    id: "checks",
    type: "checklist",
    label: "Revisión",
    items: [
      { id: "a", label: "Luz" },
      { id: "b", label: "Alarma" },
    ],
  },
  { id: "when", type: "date", label: "Fecha" },
  { id: "notes", type: "text", label: "Notas" },
  { id: "pics", type: "photo", label: "Fotos", max: 2 },
  { id: "sign", type: "signature", label: "Firma", required: true },
]);

describe("respuestas de un registro", () => {
  it("todo conforme: guarda las respuestas normalizadas y los adjuntos", () => {
    const checked = checkAnswers(fields, {
      temp: 3.5,
      door: "yes",
      floor: "clean",
      checks: ["a", "b", "a"],
      when: "2026-10-30",
      notes: "  sin novedad  ",
      pics: ["f1"],
      sign: "f2",
      extra: "ignorado",
    });
    expect(checked.problems).toEqual([]);
    expect(checked.nonConforming).toEqual([]);
    expect(checked.answers).toEqual({
      temp: 3.5,
      door: "yes",
      floor: "clean",
      checks: ["a", "b"],
      when: "2026-10-30",
      notes: "sin novedad",
      pics: ["f1"],
      sign: "f2",
    });
    expect(checked.files).toEqual([
      { fieldId: "pics", ids: ["f1"] },
      { fieldId: "sign", ids: ["f2"] },
    ]);
  });

  it("marca lo no conforme: fuera de rango, la respuesta marcada, una opción, un ítem sin marcar", () => {
    const checked = checkAnswers(fields, {
      temp: 7,
      door: "no",
      floor: "dirty",
      checks: ["a"],
      sign: "f2",
    });
    expect(checked.problems).toEqual([]);
    expect(checked.nonConforming).toEqual(["temp", "door", "floor", "checks"]);
    // Below the range too, and the edges are fine.
    expect(checkAnswers(fields, { temp: -1, sign: "s" }).nonConforming).toEqual(["temp"]);
    expect(checkAnswers(fields, { temp: 0, sign: "s" }).nonConforming).toEqual([]);
    expect(checkAnswers(fields, { temp: 4, sign: "s" }).nonConforming).toEqual([]);
    // A checklist sent with nothing checked is an answer, non-conforming.
    expect(checkAnswers(fields, { temp: 2, sign: "s", checks: [] }).nonConforming).toEqual(["checks"]);
  });

  it("los obligatorios que faltan y las respuestas que no encajan son problemas", () => {
    const checked = checkAnswers(fields, {
      temp: "frío",
      door: "quizás",
      floor: "otro",
      checks: ["z"],
      when: "2026-02-30",
      notes: "x".repeat(501),
      pics: ["a", "b", "c"],
    });
    expect(checked.problems).toEqual([
      { fieldId: "temp", reason: "invalid" },
      { fieldId: "door", reason: "invalid" },
      { fieldId: "floor", reason: "invalid" },
      { fieldId: "checks", reason: "invalid" },
      { fieldId: "when", reason: "invalid" },
      { fieldId: "notes", reason: "invalid" },
      { fieldId: "pics", reason: "invalid" },
      { fieldId: "sign", reason: "required" },
    ]);
    expect(checkAnswers(fields, { sign: "s", temp: "" }).problems).toEqual([
      { fieldId: "temp", reason: "required" },
    ]);
  });
});
