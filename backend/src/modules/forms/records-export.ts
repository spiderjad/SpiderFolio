// A form's records exported (docs/spec/formularios.md, phase 4): the same records the person sees in
// the list, with the same filters, as a CSV (one column per field of any version exported) or a PDF
// (one block per record, made by Gotenberg). Dates and times in the company's zone; audited.
import { escapeHtml } from "@spiderfolio/content";
import { formExportTexts, formMessages } from "../../i18n/index.ts";
import { currentLocale } from "../../i18n/locales.ts";
import { toCsv } from "../../lib/csv.ts";
import { AppError, notFound } from "../../lib/errors.ts";
import { companyZone, formatDateTimeIn } from "../../lib/time-zone.ts";
import { levelOfNode, requireLevel } from "../access/access-context.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { renderWithGotenberg } from "../documents/pdf.ts";
import { FieldsSchema, type FormField, type RecordFilters } from "./forms.schemas.ts";
import { recordsWhere, viewsOf, type RecordView } from "./records.service.ts";

/** Most records in one export: past this, narrow it down with the dates. */
export const CSV_EXPORT_MAX = 10_000;
export const PDF_EXPORT_MAX = 300;

export interface ExportDeps {
  /** Without Gotenberg (an install without the pdf profile) there's no PDF. */
  gotenbergUrl: string | undefined;
}

export interface AnswerWords {
  yes: string;
  no: string;
  unchecked: (items: string) => string;
  photos: (count: number) => string;
  signed: string;
}

/** An answer as text, with the labels of the version it was filled with. */
export function answerText(field: FormField, answer: unknown, words: AnswerWords): string {
  switch (field.type) {
    case "text":
    case "date":
      return typeof answer === "string" ? answer : "";
    case "number":
      if (typeof answer !== "number") return "";
      return field.unit === undefined ? String(answer) : `${String(answer)} ${field.unit}`;
    case "yesno":
      return answer === "yes" ? words.yes : answer === "no" ? words.no : "";
    case "choice":
      return field.options.find((option) => option.id === answer)?.label ?? "";
    case "checklist": {
      const checked = new Set(Array.isArray(answer) ? answer : []);
      const done = field.items.filter((item) => checked.has(item.id)).map((item) => item.label);
      const missing = field.items.filter((item) => !checked.has(item.id)).map((item) => item.label);
      return [done.join("; "), missing.length > 0 ? words.unchecked(missing.join("; ")) : ""]
        .filter((part) => part !== "")
        .join(" ");
    }
    case "photo":
      return Array.isArray(answer) && answer.length > 0 ? words.photos(answer.length) : "";
    case "signature":
      return typeof answer === "string" && answer !== "" ? words.signed : "";
  }
}

/**
 * The columns of a CSV: the current version's fields first, then any field of an older version that
 * isn't in it any more (by id), each with its newest label.
 */
export function exportColumns(
  versions: readonly { version: number; fields: readonly FormField[] }[],
): { id: string; label: string }[] {
  const columns = new Map<string, string>();
  for (const { fields } of [...versions].sort((a, b) => b.version - a.version)) {
    for (const field of fields) if (!columns.has(field.id)) columns.set(field.id, field.label);
  }
  return [...columns].map(([id, label]) => ({ id, label }));
}

export interface ExportFile {
  fileName: string;
  contentType: string;
  body: string | Uint8Array;
}

export async function exportRecords(
  ctx: AdminContext,
  deps: ExportDeps,
  formId: string,
  format: "csv" | "pdf",
  filters: RecordFilters,
): Promise<ExportFile> {
  const form = await ctx.db.node.findFirst({
    where: { id: formId, trashedAt: null, type: "FORM" },
    select: { id: true, name: true, currentVersion: true, space: { select: { name: true } } },
  });
  if (form === null) throw notFound();
  requireLevel(await levelOfNode(ctx, formId), "VIEW");
  if (format === "pdf" && deps.gotenbergUrl === undefined) {
    throw new AppError("UNAVAILABLE", { message: formMessages.pdfUnavailable });
  }
  const t = formExportTexts;
  const where = await recordsWhere(ctx, formId, filters);
  const max = format === "csv" ? CSV_EXPORT_MAX : PDF_EXPORT_MAX;
  const total = await ctx.db.formRecord.count({ where });
  if (total > max) {
    throw new AppError("BAD_REQUEST", {
      message: t.tooMany(max.toLocaleString(currentLocale())),
    });
  }
  const rows = await ctx.db.formRecord.findMany({
    where,
    orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
    take: max,
  });
  const versionRows = await ctx.db.formVersion.findMany({
    where: {
      nodeId: formId,
      version: { in: [...new Set([form.currentVersion, ...rows.map((row) => row.version)])] },
    },
    select: { version: true, fields: true },
  });
  const versions = versionRows.map((row) => ({
    version: row.version,
    fields: FieldsSchema.parse(row.fields),
  }));
  const fieldsOf = new Map(versions.map((entry) => [entry.version, entry.fields]));
  const records = await viewsOf(ctx, rows);
  const zone = await companyZone(ctx.db);
  const locale = currentLocale();
  const when = (date: Date) => formatDateTimeIn(date, zone, locale);
  await auditAdmin(ctx, {
    action: "form.records.export",
    entityType: "Node",
    entityId: formId,
    metadata: { format, rows: records.length, filters: { ...filters } },
  });

  if (format === "csv") {
    const columns = exportColumns(versions);
    const cell = (record: RecordView, id: string) => {
      const field = fieldsOf.get(record.version)?.find((candidate) => candidate.id === id);
      return field === undefined ? "" : answerText(field, record.answers[id], t.words);
    };
    return {
      fileName: t.fileName(form.name, "csv"),
      contentType: "text/csv; charset=utf-8",
      body: toCsv(
        [...t.headers, ...columns.map((column) => column.label)],
        records.map((record) => [
          when(record.submittedAt),
          record.submittedBy?.name ?? "",
          record.version,
          t.sources[record.source === "qr" ? "qr" : "app"],
          record.nonConforming.length > 0 ? t.words.yes : t.words.no,
          record.voided === null ? "" : when(record.voided.at),
          record.voided?.reason ?? "",
          ...columns.map((column) => cell(record, column.id)),
        ]),
      ),
    };
  }

  const blocks = records.map((record) => {
    const fields = fieldsOf.get(record.version) ?? [];
    const off = new Set(record.nonConforming);
    const meta = [
      t.version(record.version),
      t.sources[record.source === "qr" ? "qr" : "app"],
      ...(off.size > 0 ? [`<strong class="bad">${escapeHtml(t.nonConforming)}</strong>`] : []),
    ];
    const voided =
      record.voided === null
        ? ""
        : `<p class="voided">${escapeHtml(
            t.voided(when(record.voided.at), record.voided.by?.name ?? "", record.voided.reason),
          )}</p>`;
    const answers = fields
      .map(
        (field) =>
          `<tr${off.has(field.id) ? ' class="bad"' : ""}><th>${escapeHtml(field.label)}</th><td>${escapeHtml(
            answerText(field, record.answers[field.id], t.words),
          )}</td></tr>`,
      )
      .join("");
    return `<section${record.voided === null ? "" : ' class="void"'}><h2>${escapeHtml(
      `${when(record.submittedAt)} · ${record.submittedBy?.name ?? ""}`,
    )}</h2><p class="meta">${meta.join(" · ")}</p>${voided}<table>${answers}</table></section>`;
  });
  const style = `
    body { font-family: Helvetica, Arial, sans-serif; font-size: 10pt; line-height: 1.4; color: #1a1a1a; }
    h1 { font-size: 18pt; margin: 0 0 .2em; } h2 { font-size: 11.5pt; margin: 0 0 .2em; }
    .meta { color: #555; margin: 0 0 .5em; } .bad { color: #b91c1c; } tr.bad td { font-weight: bold; }
    section { break-inside: avoid; border-top: 1px solid #ccc; padding: .8em 0; }
    section.void { color: #777; } .voided { color: #b45309; margin: 0 0 .5em; }
    table { border-collapse: collapse; width: 100%; } th, td { border: 1px solid #bbb; padding: 3px 6px; vertical-align: top; text-align: left; }
    th { width: 38%; background: #f3f3f3; font-weight: normal; }
  `;
  const small =
    "font-family: Helvetica, Arial, sans-serif; font-size: 8px; color: #555; width: 100%; padding: 0 40px;";
  const html = `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><style>${style}</style></head><body><h1>${escapeHtml(
    form.name,
  )}</h1><p class="meta">${escapeHtml(
    t.summary(form.space.name, when(new Date()), records.length),
  )}</p>${blocks.join("") || `<p>${escapeHtml(t.empty)}</p>`}</body></html>`;
  const pdf = await renderWithGotenberg(deps.gotenbergUrl ?? "", {
    html,
    header: `<html><head><style>body{margin:0}</style></head><body><div style="${small} text-align:right;">${escapeHtml(form.name)}</div></body></html>`,
    footer: `<html><head><style>body{margin:0}</style></head><body><div style="${small} text-align:center;">${t.pageFooter('<span class="pageNumber"></span>', '<span class="totalPages"></span>')}</div></body></html>`,
  });
  return { fileName: t.fileName(form.name, "pdf"), contentType: "application/pdf", body: pdf };
}
