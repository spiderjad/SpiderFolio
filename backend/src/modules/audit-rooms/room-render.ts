// What an auditor opens, as a PDF with «Copia para auditoría · [email] · [date]» on every page
// (docs/spec/salas-de-auditoria.md): pages through Gotenberg, PDFs stamped, Word and Excel through
// Gotenberg's LibreOffice, images on a page; the reports as tables. Always with the room creator's access
// (a room never shows more than its creator sees).
import { contentToHtml, escapeHtml } from "@spiderfolio/content";
import type { JSONContent } from "@tiptap/core";
import { auditRoomTexts, safetyTexts } from "../../i18n/index.ts";
import { currentLocale } from "../../i18n/locales.ts";
import { AppError, notFound } from "../../lib/errors.ts";
import type { Storage } from "../../lib/storage.ts";
import { companyZone, formatDateTimeIn, formatUtcDay } from "../../lib/time-zone.ts";
import type { AdminContext } from "../admin/admin-context.ts";
import { listAudit } from "../audit/audit-log.service.ts";
import { publishedFileVersionOf } from "../documents/controlled-guard.ts";
import { getControlled } from "../documents/documents.service.ts";
import { ReadingsQuerySchema } from "../documents/documents.schemas.ts";
import {
  convertWithLibreOffice,
  imageToPdf,
  renderWithGotenberg,
  stampPdf,
} from "../documents/pdf.ts";
import {
  ensureControlledPdf,
  MAX_STAMP_BYTES,
  pageImageSources,
  toBuffer,
} from "../documents/pdf.service.ts";
import { readingsOverview } from "../documents/readings.service.ts";
import { exportRecords } from "../forms/records-export.ts";
import { ListDeliveriesQuerySchema } from "../safety/ppe.schemas.ts";
import { listDeliveries } from "../safety/ppe.service.ts";
import { getCourse } from "../safety/training.service.ts";
import type { ItemRow } from "./room-items.ts";
import type { PrismaClient } from "../../lib/prisma.ts";

export interface RenderDeps {
  prisma: PrismaClient;
  storage: Storage;
  gotenbergUrl: string | undefined;
}

/** Most rows a report shows (an audit asks for a period, not the whole history). */
const MAX_ROWS = 2000;

const OFFICE = new Set([
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.oasis.opendocument.presentation",
  "application/rtf",
  "text/plain",
  "text/csv",
]);

const STYLE = `
  body { font-family: Helvetica, Arial, sans-serif; font-size: 10.5pt; color: #1a1a1a; }
  h1 { font-size: 16pt; margin: 0 0 .3em; } .meta { color: #555; margin: 0 0 1em; }
  table { border-collapse: collapse; width: 100%; } th, td { border: 1px solid #bbb; padding: 4px 7px; text-align: left; vertical-align: top; }
  th { background: #f3f3f3; font-weight: normal; } img { max-width: 100%; }
`;

const small =
  "font-family: Helvetica, Arial, sans-serif; font-size: 8px; color: #555; width: 100%; padding: 0 40px;";

function needsGotenberg(deps: RenderDeps): string {
  if (deps.gotenbergUrl === undefined) throw new AppError("UNAVAILABLE");
  return deps.gotenbergUrl;
}

async function htmlPdf(deps: RenderDeps, title: string, body: string): Promise<Uint8Array> {
  return await renderWithGotenberg(needsGotenberg(deps), {
    html: `<!doctype html><html lang="${currentLocale()}"><head><meta charset="utf-8"><style>${STYLE}</style></head><body><h1>${escapeHtml(title)}</h1>${body}</body></html>`,
    header: `<html><head><style>body{margin:0}</style></head><body><div style="${small} text-align:right;">${escapeHtml(title)}</div></body></html>`,
    footer: `<html><head><style>body{margin:0}</style></head><body><div style="${small} text-align:center;">${safetyTexts.pdf.pageFooter('<span class="pageNumber"></span>', '<span class="totalPages"></span>')}</div></body></html>`,
  });
}

const table = (headers: string[], rows: string[][]) =>
  rows.length === 0
    ? `<p class="meta">${escapeHtml(auditRoomTexts.reports.empty)}</p>`
    : `<table><thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead><tbody>${rows
        .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`)
        .join("")}</tbody></table>`;

/** A document (page or file) as a PDF, before the watermark. */
async function nodePdf(ctx: AdminContext, deps: RenderDeps, nodeId: string): Promise<Uint8Array> {
  const node = await ctx.db.node.findFirst({
    where: { id: nodeId, trashedAt: null },
    select: { id: true, name: true, type: true, currentVersion: true },
  });
  if (node === null) throw notFound();
  const controlled = await ctx.db.controlledDocument.findFirst({
    where: { nodeId },
    select: { publishedVersion: true },
  });
  if (node.type === "PAGE") {
    // A controlled page: its current version's controlled PDF.
    if (controlled?.publishedVersion != null) {
      const key = await ensureControlledPdf(
        ctx.db,
        deps,
        ctx.tenant.workspaceId,
        nodeId,
        controlled.publishedVersion,
      );
      return await toBuffer(await deps.storage.stream(key), MAX_STAMP_BYTES);
    }
    const page = await ctx.db.pageContent.findFirst({
      where: { nodeId },
      select: { content: true },
    });
    const images = await pageImageSources(ctx.db, deps, nodeId);
    const body =
      page === null
        ? ""
        : contentToHtml(page.content as JSONContent, { imageSrc: (id) => images.get(id) ?? null });
    return await htmlPdf(deps, node.name, body);
  }
  if (node.type !== "FILE") throw notFound();
  // A controlled file: its current version; otherwise the latest.
  const version =
    controlled === null ? node.currentVersion : await publishedFileVersionOf(ctx.db, nodeId);
  if (version === null) throw notFound();
  const file = await ctx.db.fileVersion.findFirst({
    where: { nodeId, version, purgedAt: null },
    select: { storageKey: true, mimeType: true, sizeBytes: true },
  });
  if (file === null) throw notFound();
  if (Number(file.sizeBytes) > MAX_STAMP_BYTES) throw new AppError("PAYLOAD_TOO_LARGE");
  const bytes = await toBuffer(await deps.storage.stream(file.storageKey), MAX_STAMP_BYTES);
  if (file.mimeType === "application/pdf") return bytes;
  if (file.mimeType === "image/png" || file.mimeType === "image/jpeg") {
    return await imageToPdf(bytes, file.mimeType);
  }
  if (OFFICE.has(file.mimeType)) {
    return await convertWithLibreOffice(needsGotenberg(deps), { name: node.name, bytes });
  }
  throw new AppError("BAD_REQUEST", { message: auditRoomTexts.errors.unsupported });
}

/** A report as a PDF, before the watermark. */
async function reportPdf(ctx: AdminContext, deps: RenderDeps, item: ItemRow): Promise<Uint8Array> {
  const t = auditRoomTexts.reports;
  const c = t.columns;
  const p = item.params;
  const zone = await companyZone(ctx.db);
  const locale = currentLocale();
  const when = (date: Date) => formatDateTimeIn(date, zone, locale);
  const dayOf = (value: string) => formatUtcDay(new Date(`${value}T12:00:00Z`), locale);
  const meta = `<p class="meta">${escapeHtml(t.generated(when(new Date())))}</p>`;
  switch (item.report) {
    case "readings": {
      const rows: string[][] = [];
      for (let page = 1; rows.length < MAX_ROWS; page += 1) {
        const overview = await readingsOverview(
          ctx,
          p.nodeId ?? "",
          ReadingsQuerySchema.parse({ pageSize: 100, page }),
        );
        for (const person of overview.people.items) {
          rows.push([
            person.name,
            t.readingStatus[person.status],
            person.readAt === null ? "—" : when(person.readAt),
          ]);
        }
        if (overview.people.nextCursor === null) break;
      }
      return await htmlPdf(deps, item.title, meta + table([c.person, c.status, c.readAt], rows));
    }
    case "approvals": {
      const info = await getControlled(ctx, p.nodeId ?? "");
      const versions = info.controlled?.versions ?? [];
      const rows = versions.map((version) => [
        `v${String(version.version)}`,
        version.status,
        version.publishedAt === null ? "—" : when(version.publishedAt),
        version.approvals
          .map((approval) =>
            approval.decision === null
              ? approval.approver.name
              : `${approval.approver.name}: ${t.decisions[approval.decision]}`,
          )
          .join("; "),
        version.changeReason ?? version.changeNote ?? "",
      ]);
      return await htmlPdf(
        deps,
        item.title,
        meta + table([c.version, c.state, c.published, c.approvals, c.change], rows),
      );
    }
    case "form-records": {
      // The form's own PDF export, with the room's period (and without counting as an export).
      const file = await exportRecords(
        ctx,
        deps,
        p.formId ?? "",
        "pdf",
        { from: p.from, to: p.to, status: "all", nonConforming: false },
        { audit: false },
      );
      if (typeof file.body === "string") throw new AppError("UNAVAILABLE");
      return file.body;
    }
    case "training": {
      const { people } = await getCourse(ctx, p.courseId ?? "");
      const states = safetyTexts.personPdf.states;
      const rows = people.map((person) => [
        person.name,
        states[person.state],
        person.completedAt === null ? "—" : formatUtcDay(person.completedAt, locale),
        person.source === "READING" || person.source === "IN_PERSON"
          ? t.sources[person.source]
          : "—",
        person.validUntil === null ? "—" : dayOf(person.validUntil),
      ]);
      return await htmlPdf(
        deps,
        item.title,
        meta + table([c.person, c.state, c.completed, c.source, c.until], rows),
      );
    }
    case "ppe": {
      const rows: string[][] = [];
      for (let page = 1; rows.length < MAX_ROWS; page += 1) {
        const result = await listDeliveries(
          ctx,
          ListDeliveriesQuerySchema.parse({ from: p.from, to: p.to, pageSize: 100, page }),
        );
        for (const delivery of result.items) {
          rows.push([
            when(delivery.deliveredAt),
            delivery.person.name,
            delivery.lines.map((line) => `${line.item.name} × ${String(line.quantity)}`).join("; "),
            delivery.voided === null
              ? delivery.deliveredBy.name
              : `${t.voided} · ${delivery.voided.reason}`,
          ]);
        }
        if (result.nextCursor === null) break;
      }
      return await htmlPdf(deps, item.title, meta + table([c.date, c.person, c.item, c.by], rows));
    }
    case "audit-log": {
      const rows: string[][] = [];
      let cursor: string | undefined;
      while (rows.length < MAX_ROWS) {
        const page = await listAudit(ctx, deps, {
          from: p.from,
          to: p.to,
          ...(p.action === undefined ? {} : { action: p.action }),
          limit: 100,
          ...(cursor === undefined ? {} : { cursor }),
        });
        for (const event of page.items) {
          rows.push([
            when(event.createdAt),
            event.actor?.name ?? event.actor?.email ?? "—",
            event.action,
            [event.entityType, event.entityId].filter((part) => part !== null).join(" "),
          ]);
        }
        if (page.nextCursor === null) break;
        cursor = page.nextCursor;
      }
      return await htmlPdf(deps, item.title, meta + table([c.date, c.by, c.action, c.what], rows));
    }
    default:
      throw notFound();
  }
}

/** The item (or one document inside a shared folder or space) as the auditor gets it. */
export async function roomItemPdf(
  ctx: AdminContext,
  deps: RenderDeps,
  item: ItemRow,
  nodeId: string | null,
  watermark: string,
): Promise<Uint8Array> {
  const source =
    item.kind === "REPORT"
      ? await reportPdf(ctx, deps, item)
      : await nodePdf(ctx, deps, nodeId ?? item.nodeId ?? "");
  return await stampPdf(source, { watermark, obsolete: false, diagonal: watermark });
}
