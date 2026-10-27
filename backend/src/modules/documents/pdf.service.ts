// PDF controlado: generarlo al publicar (job) o a pedido y descargarlo con la marca de agua.
// Páginas: HTML → PDF con Gotenberg, guardado en el bucket (`pdfKey`). Archivos PDF: el original con
// la hoja de control al principio. Solo las versiones publicadas u obsoletas tienen PDF controlado.
import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { contentToHtml } from "@spiderfolio/content";
import type { JSONContent } from "@tiptap/core";
import type { TenantDb } from "../../db/tenant.ts";
import { contentMessages, controlledPdfTexts } from "../../i18n/index.ts";
import { AppError, notFound } from "../../lib/errors.ts";
import type { Storage } from "../../lib/storage.ts";
import { levelOfNode, requireLevel } from "../access/access-context.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { controlledHtml, renderWithGotenberg, stampPdf, type ControlInfo } from "./pdf.ts";
import { currentLocale, readWorkspaceLocale, withLocale } from "../../i18n/locales.ts";

export interface PdfDeps {
  storage: Storage;
  /** Sin Gotenberg (instalación sin el perfil pdf) no se genera el PDF de las páginas. */
  gotenbergUrl: string | undefined;
}

/** Tope de un PDF subido que se estampa en memoria. */
const MAX_STAMP_BYTES = 60 * 1024 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

async function toBuffer(stream: Readable, max: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > max) throw new AppError("PAYLOAD_TOO_LARGE");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function settingsZone(settings: unknown): string {
  const raw = (settings as { timezone?: unknown } | null | undefined)?.timezone;
  return typeof raw === "string" && raw !== "" ? raw : "UTC";
}

function formatter(timeZone: string, withTime: boolean): (date: Date) => string {
  const options: Intl.DateTimeFormatOptions = withTime
    ? { dateStyle: "short", timeStyle: "short" }
    : { dateStyle: "long" };
  try {
    const format = new Intl.DateTimeFormat(currentLocale(), { ...options, timeZone });
    return (date) => format.format(date);
  } catch {
    const format = new Intl.DateTimeFormat(currentLocale(), { ...options, timeZone: "UTC" });
    return (date) => format.format(date);
  }
}

/** Todo lo que lleva la hoja de control de una versión publicada u obsoleta. */
async function controlInfo(db: TenantDb, nodeId: string, version: number) {
  const [row, controlled, workspace] = await Promise.all([
    db.documentVersion.findFirst({ where: { nodeId, version } }),
    db.controlledDocument.findFirst({ where: { nodeId } }),
    db.workspace.findFirst({ where: {}, select: { name: true, settings: true } }),
  ]);
  if (row === null || controlled === null || workspace === null) throw notFound();
  const zone = settingsZone(workspace.settings);
  const day = formatter(zone, false);
  const approvals = await db.approval.findMany({
    where: {
      nodeId,
      version,
      decision: "APPROVED",
      ...(row.submittedAt === null ? {} : { round: row.submittedAt }),
    },
    orderBy: { decidedAt: "asc" },
    select: { approverId: true, decidedAt: true },
  });
  const ids = [
    ...new Set([
      ...approvals.map((a) => a.approverId),
      ...(row.submittedById === null ? [] : [row.submittedById]),
    ]),
  ];
  const names = new Map(
    (
      await db.membership.findMany({
        where: { id: { in: ids } },
        select: { id: true, user: { select: { name: true } } },
      })
    ).map((member) => [member.id, member.user.name]),
  );
  const info: ControlInfo = {
    workspaceName: workspace.name,
    code: controlled.code,
    title: row.title,
    version,
    effective: day(row.effectiveAt ?? row.publishedAt ?? row.createdAt),
    elaboratedBy: row.submittedById === null ? null : (names.get(row.submittedById) ?? null),
    approvedBy: approvals.map((a) => ({
      name: names.get(a.approverId) ?? "",
      at: a.decidedAt === null ? "" : day(a.decidedAt),
    })),
  };
  return { info, row, zone };
}

/** Los textos del PDF y de su marca van en el idioma de la empresa (el documento es suyo). */
async function inWorkspaceLocale<T>(db: TenantDb, fn: () => Promise<T>): Promise<T> {
  const workspace = await db.workspace.findFirst({ where: {}, select: { settings: true } });
  return withLocale(readWorkspaceLocale(workspace?.settings), fn);
}

/** Genera (y guarda) el PDF de una página publicada. Devuelve la clave en el bucket. */
export function ensureControlledPdf(
  db: TenantDb,
  deps: PdfDeps,
  workspaceId: string,
  nodeId: string,
  version: number,
): Promise<string> {
  return inWorkspaceLocale(db, () => generateControlledPdf(db, deps, workspaceId, nodeId, version));
}

async function generateControlledPdf(
  db: TenantDb,
  deps: PdfDeps,
  workspaceId: string,
  nodeId: string,
  version: number,
): Promise<string> {
  const { info, row } = await controlInfo(db, nodeId, version);
  if (row.pdfKey !== null) return row.pdfKey;
  if (row.content === null) {
    throw new AppError("BAD_REQUEST", { message: contentMessages.noPdfForVersion });
  }
  // Las imágenes de la página viajan dentro del HTML (data: URI); Gotenberg no sale a internet.
  const images = new Map<string, string>();
  const rows = await db.pageImage.findMany({
    where: { nodeId, confirmedAt: { not: null } },
    select: { id: true, storageKey: true, mimeType: true, sizeBytes: true },
  });
  for (const image of rows) {
    if (Number(image.sizeBytes) > MAX_IMAGE_BYTES) continue;
    try {
      const data = await toBuffer(await deps.storage.stream(image.storageKey), MAX_IMAGE_BYTES);
      images.set(image.id, `data:${image.mimeType};base64,${data.toString("base64")}`);
    } catch {
      // Una imagen que no se puede leer queda como «[Imagen]».
    }
  }
  const body = contentToHtml(row.content as JSONContent, {
    imageSrc: (id) => images.get(id) ?? null,
  });
  if (deps.gotenbergUrl === undefined) {
    throw new AppError("UNAVAILABLE", { message: contentMessages.controlledPdfUnavailable });
  }
  const pdf = await renderWithGotenberg(deps.gotenbergUrl, controlledHtml(info, body));
  const key = `${workspaceId}/${nodeId}/controlled-v${String(version)}-${randomBytes(12).toString("hex")}.pdf`;
  await deps.storage.putStream(key, Readable.from(Buffer.from(pdf)), {
    size: pdf.length,
    contentType: "application/pdf",
  });
  await db.documentVersion.update({ where: { id: row.id }, data: { pdfKey: key } });
  return key;
}

/**
 * Descarga el PDF controlado de una versión (la vigente por defecto) con la marca de agua. Se
 * arma en cada descarga: la marca lleva quién descargó y cuándo.
 */
export function downloadControlledPdf(
  ctx: AdminContext,
  deps: PdfDeps,
  nodeId: string,
  versionParam: number | undefined,
): Promise<{ bytes: Uint8Array; fileName: string }> {
  return inWorkspaceLocale(ctx.db, () => stampControlledPdf(ctx, deps, nodeId, versionParam));
}

async function stampControlledPdf(
  ctx: AdminContext,
  deps: PdfDeps,
  nodeId: string,
  versionParam: number | undefined,
): Promise<{ bytes: Uint8Array; fileName: string }> {
  const node = await ctx.db.node.findFirst({
    where: { id: nodeId, trashedAt: null },
    select: { id: true, type: true, name: true },
  });
  if (node === null) throw notFound();
  requireLevel(await levelOfNode(ctx, nodeId), "VIEW");
  const controlled = await ctx.db.controlledDocument.findFirst({
    where: { nodeId },
    select: { publishedVersion: true, code: true },
  });
  if (controlled === null) {
    throw new AppError("BAD_REQUEST", { message: contentMessages.notControlled });
  }
  const version = versionParam ?? controlled.publishedVersion;
  if (version === null)
    throw new AppError("CONFLICT", { message: contentMessages.nothingPublished });
  const { info, row, zone } = await controlInfo(ctx.db, nodeId, version);
  if (row.status !== "PUBLISHED" && row.status !== "OBSOLETE") {
    throw new AppError("CONFLICT", { message: contentMessages.noPdfForVersion });
  }
  const me = await ctx.db.membership.findFirst({
    where: { id: ctx.tenant.membershipId },
    select: { user: { select: { name: true } } },
  });
  const watermark = controlledPdfTexts.watermark(
    me?.user.name ?? "",
    formatter(zone, true)(new Date()),
  );
  const obsolete = row.status === "OBSOLETE";

  let source: Uint8Array;
  let controlSheet: ControlInfo | undefined;
  if (node.type === "PAGE") {
    const key = await ensureControlledPdf(ctx.db, deps, ctx.tenant.workspaceId, nodeId, version);
    source = await toBuffer(await deps.storage.stream(key), MAX_STAMP_BYTES);
  } else {
    const file =
      row.fileVersion === null
        ? null
        : await ctx.db.fileVersion.findFirst({
            where: { nodeId, version: row.fileVersion, purgedAt: null },
            select: { storageKey: true, mimeType: true, sizeBytes: true },
          });
    if (file === null) throw notFound();
    if (file.mimeType !== "application/pdf") {
      throw new AppError("BAD_REQUEST", { message: contentMessages.pdfOnly });
    }
    if (Number(file.sizeBytes) > MAX_STAMP_BYTES) throw new AppError("PAYLOAD_TOO_LARGE");
    source = await toBuffer(await deps.storage.stream(file.storageKey), MAX_STAMP_BYTES);
    controlSheet = info;
  }
  const bytes = await stampPdf(source, {
    watermark,
    obsolete,
    ...(controlSheet === undefined ? {} : { controlSheet }),
  });
  await auditAdmin(ctx, {
    action: "document.pdf.download",
    entityType: "Node",
    entityId: nodeId,
    metadata: { code: controlled.code, version, obsolete },
  });
  return {
    bytes,
    fileName: `${controlled.code} v${String(version)}${obsolete ? ` ${controlledPdfTexts.obsolete}` : ""}.pdf`,
  };
}
