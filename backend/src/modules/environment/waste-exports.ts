// The waste exports (docs/spec/medio-ambiente.md, section 2): the chronological record (Ley 7/2022,
// art. 64), the SANDACH dispatch register (Regulation (EU) 142/2011, annex VIII) and the annual
// summary, as CSV or PDF. Recorded in the audit log.
import { escapeHtml } from "@spiderfolio/content";
import { AppError } from "../../lib/errors.ts";
import { toCsv } from "../../lib/csv.ts";
import { companyZone, formatDateTimeIn, formatDayIn } from "../../lib/time-zone.ts";
import { environmentTexts } from "../../i18n/index.ts";
import { currentLocale } from "../../i18n/locales.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { renderWithGotenberg } from "../documents/pdf.ts";
import { dateOf, requireView } from "./environment-access.ts";
import { movementsForExport, type MovementView } from "./waste.service.ts";

export type ExportFormat = "csv" | "pdf";
export type ExportKind = "chronological" | "sandach" | "annual";

export interface ExportFile {
  fileName: string;
  contentType: string;
  body: string | Uint8Array;
}

interface Table {
  title: string;
  subtitle: string;
  columns: readonly string[];
  rows: string[][];
  fileName: string;
}

const STYLE = `
  body { font-family: Helvetica, Arial, sans-serif; font-size: 8.5px; color: #111; }
  h1 { font-size: 15px; margin: 0 0 .3em; } .meta { color: #555; margin: 0 0 .8em; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #bbb; padding: 3px 4px; text-align: left; vertical-align: top; }
  th { background: #f3f3f3; font-weight: normal; } thead { display: table-header-group; }
  tr { page-break-inside: avoid; } td.n { text-align: right; white-space: nowrap; }
`;

async function pdfOf(gotenbergUrl: string, table: Table, generated: string): Promise<Uint8Array> {
  const t = environmentTexts;
  const html = `<!doctype html><html lang="${currentLocale()}"><head><meta charset="utf-8"><style>${STYLE}</style></head><body><h1>${escapeHtml(
    table.title,
  )}</h1><p class="meta">${escapeHtml(table.subtitle)} · ${escapeHtml(generated)}</p><table><thead><tr>${table.columns
    .map((cell) => `<th>${escapeHtml(cell)}</th>`)
    .join("")}</tr></thead><tbody>${table.rows
    .map(
      (row) =>
        `<tr>${row
          .map((cell) => {
            const numeric = /^-?[\d.,]+$/u.test(cell);
            return `<td${numeric ? ' class="n"' : ""}>${escapeHtml(cell)}</td>`;
          })
          .join("")}</tr>`,
    )
    .join("")}</tbody></table></body></html>`;
  const small =
    "font-family: Helvetica, Arial, sans-serif; font-size: 8px; color: #555; width: 100%; padding: 0 40px;";
  return await renderWithGotenberg(gotenbergUrl, {
    html,
    header: `<html><head><style>body{margin:0}</style></head><body><div style="${small} text-align:right;">${escapeHtml(table.title)}</div></body></html>`,
    footer: `<html><head><style>body{margin:0}</style></head><body><div style="${small} text-align:center;">${t.pageFooter('<span class="pageNumber"></span>', '<span class="totalPages"></span>')}</div></body></html>`,
  });
}

const quantityText = (value: number, locale: string) =>
  new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(value);

function chronological(rows: MovementView[], day: (iso: string) => string, locale: string) {
  const t = environmentTexts;
  return rows.map((row) => [
    day(row.date),
    row.waste.name,
    row.waste.ler,
    row.waste.hazardous ? t.yes : t.no,
    row.waste.sandach === null ? "" : t.sandach[row.waste.sandach],
    quantityText(row.quantity, locale),
    t.units[row.unit],
    row.manager?.name ?? "",
    row.manager?.nima ?? "",
    row.operation,
    row.carrier?.name ?? "",
    row.documentRef,
    row.vehicle,
    row.notes,
  ]);
}

function sandachRows(rows: MovementView[], day: (iso: string) => string, locale: string) {
  const t = environmentTexts;
  return rows.map((row) => [
    day(row.date),
    row.waste.sandach === null ? "" : t.sandach[row.waste.sandach],
    row.waste.name,
    quantityText(row.quantity, locale),
    t.units[row.unit],
    row.manager?.name ?? "",
    row.manager?.nima ?? "",
    row.carrier?.name ?? "",
    row.vehicle,
    row.documentRef,
  ]);
}

/** Totals by waste, manager and unit (units aren't mixed). */
function annualRows(rows: MovementView[], locale: string) {
  const t = environmentTexts;
  const groups = new Map<string, { row: MovementView; count: number; total: number }>();
  for (const row of rows) {
    const key = `${row.waste.id}|${row.manager?.id ?? ""}|${row.unit}`;
    const group = groups.get(key);
    if (group === undefined) groups.set(key, { row, count: 1, total: row.quantity });
    else {
      group.count += 1;
      group.total += row.quantity;
    }
  }
  return [...groups.values()]
    .sort(
      (a, b) =>
        a.row.waste.ler.localeCompare(b.row.waste.ler) ||
        a.row.waste.name.localeCompare(b.row.waste.name),
    )
    .map(({ row, count, total }) => [
      row.waste.ler,
      row.waste.name,
      row.waste.hazardous ? t.yes : t.no,
      row.manager?.name ?? "",
      row.operation,
      String(count),
      quantityText(total, locale),
      t.units[row.unit],
    ]);
}

export async function exportWaste(
  ctx: AdminContext,
  deps: { gotenbergUrl: string | undefined },
  input: { kind: ExportKind; format: ExportFormat; from: string; to: string },
): Promise<ExportFile> {
  await requireView(ctx);
  if (input.format === "pdf" && deps.gotenbergUrl === undefined) {
    throw new AppError("UNAVAILABLE", { message: environmentTexts.errors.noGotenberg });
  }
  const t = environmentTexts;
  const locale = currentLocale();
  const zone = await companyZone(ctx.db);
  const day = (iso: string) => formatDayIn(dateOf(iso), "UTC", locale);
  const rows = await movementsForExport(ctx, {
    from: input.from,
    to: input.to,
    sandach: input.kind === "sandach",
  });
  const year = Number(input.from.slice(0, 4));
  const table: Table =
    input.kind === "chronological"
      ? {
          title: t.chronological.title,
          subtitle: t.chronological.subtitle(day(input.from), day(input.to)),
          columns: t.chronological.columns,
          rows: chronological(rows, day, locale),
          fileName: t.chronological.fileName(input.format),
        }
      : input.kind === "sandach"
        ? {
            title: t.sandachRegister.title,
            subtitle: t.sandachRegister.subtitle(day(input.from), day(input.to)),
            columns: t.sandachRegister.columns,
            rows: sandachRows(rows, day, locale),
            fileName: t.sandachRegister.fileName(input.format),
          }
        : {
            title: t.annual.title(year),
            subtitle: t.chronological.subtitle(day(input.from), day(input.to)),
            columns: t.annual.columns,
            rows: annualRows(rows, locale),
            fileName: t.annual.fileName(year, input.format),
          };
  await auditAdmin(ctx, {
    action: "environment.waste.export",
    entityType: "EnvWasteMovement",
    entityId: input.kind,
    metadata: { format: input.format, from: input.from, to: input.to, rows: rows.length },
  });
  if (input.format === "csv") {
    return {
      fileName: table.fileName,
      contentType: "text/csv; charset=utf-8",
      body: toCsv(table.columns, table.rows),
    };
  }
  const generated = t.generated(formatDateTimeIn(new Date(), zone, locale));
  return {
    fileName: table.fileName,
    contentType: "application/pdf",
    body: await pdfOf(deps.gotenbergUrl ?? "", table, generated),
  };
}
