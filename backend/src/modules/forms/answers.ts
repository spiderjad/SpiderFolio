// A record's answers against the fields of the version it was filled with (docs/spec/formularios.md):
// each answer checked for its field's type, the required ones present, and which ones are
// non-conforming. Pure logic: the service adds the files and the database.
import type { FormField } from "./forms.schemas.ts";

/** What's stored for each answered field. Unanswered optional fields are left out. */
export type Answer = string | number | string[];
export type Answers = Record<string, Answer>;

export type AnswerProblem = { fieldId: string; reason: "required" | "invalid" };

const TEXT_MAX = { short: 500, long: 5000 } as const;
const DAY = /^\d{4}-\d{2}-\d{2}$/u;

function isDay(value: string): boolean {
  if (!DAY.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

const isEmpty = (value: unknown) =>
  value === undefined ||
  value === null ||
  (typeof value === "string" && value.trim() === "") ||
  (Array.isArray(value) && value.length === 0);

/** One answer, normalized; undefined if it doesn't fit the field. */
function answerOf(field: FormField, value: unknown): Answer | undefined {
  switch (field.type) {
    case "text": {
      if (typeof value !== "string") return undefined;
      const text = value.trim();
      return text.length <= (field.multiline ? TEXT_MAX.long : TEXT_MAX.short) ? text : undefined;
    }
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? value : undefined;
    case "yesno":
      return value === "yes" || value === "no" ? value : undefined;
    case "choice":
      return typeof value === "string" && field.options.some((option) => option.id === value)
        ? value
        : undefined;
    case "date":
      return typeof value === "string" && isDay(value) ? value : undefined;
    case "checklist": {
      if (!Array.isArray(value) || !value.every((item) => typeof item === "string"))
        return undefined;
      const known = new Set(field.items.map((item) => item.id));
      const checked = [...new Set(value)];
      return checked.every((id) => known.has(id)) ? checked : undefined;
    }
    case "photo": {
      if (!Array.isArray(value) || !value.every((id) => typeof id === "string")) return undefined;
      const ids = [...new Set(value)];
      return ids.length >= 1 && ids.length <= field.max ? ids : undefined;
    }
    // A person: their membership id (the service checks it's someone of the company).
    case "person":
    case "signature":
      return typeof value === "string" && value.length > 0 && value.length <= 64
        ? value
        : undefined;
  }
}

/** Whether an answer is non-conforming for its field. */
export function nonConforming(field: FormField, answer: Answer | undefined): boolean {
  switch (field.type) {
    case "number":
      return (
        typeof answer === "number" &&
        ((field.min !== undefined && answer < field.min) ||
          (field.max !== undefined && answer > field.max))
      );
    case "yesno":
      return field.nonConforming !== null && answer === field.nonConforming;
    case "choice":
      return typeof answer === "string" && field.nonConforming.includes(answer);
    case "checklist": {
      // Every item has to be checked: one left unchecked (or no answer at all) is non-conforming.
      const checked = new Set(Array.isArray(answer) ? answer : []);
      return field.items.some((item) => !checked.has(item.id));
    }
    default:
      return false;
  }
}

export interface CheckedAnswers {
  answers: Answers;
  /** Ids of the non-conforming fields, in the template's order. */
  nonConforming: string[];
  /** File ids each photo or signature field points to. */
  files: { fieldId: string; ids: string[] }[];
  problems: AnswerProblem[];
}

/** Checks what was sent against the fields. Answers to fields that aren't there are ignored. */
export function checkAnswers(fields: FormField[], sent: Record<string, unknown>): CheckedAnswers {
  const answers: Answers = {};
  const problems: AnswerProblem[] = [];
  const files: { fieldId: string; ids: string[] }[] = [];
  for (const field of fields) {
    const value = sent[field.id];
    if (isEmpty(value)) {
      // A checklist with nothing checked is an answer (non-conforming), not a missing one.
      if (field.type === "checklist" && Array.isArray(value)) {
        answers[field.id] = [];
        continue;
      }
      if (field.required) problems.push({ fieldId: field.id, reason: "required" });
      continue;
    }
    const answer = answerOf(field, value);
    if (answer === undefined) {
      problems.push({ fieldId: field.id, reason: "invalid" });
      continue;
    }
    answers[field.id] = answer;
    if (field.type === "photo" && Array.isArray(answer))
      files.push({ fieldId: field.id, ids: answer });
    if (field.type === "signature" && typeof answer === "string") {
      files.push({ fieldId: field.id, ids: [answer] });
    }
  }
  const failing = fields
    .filter((field) => {
      if (field.type === "checklist" && answers[field.id] === undefined) return false;
      return nonConforming(field, answers[field.id]);
    })
    .map((field) => field.id);
  return { answers, nonConforming: failing, files, problems };
}
