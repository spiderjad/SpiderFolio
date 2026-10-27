// Códigos QR de documentos (9C.6). La URL corta /q/:token abre siempre la versión vigente. Por
// defecto exige sesión y que la persona vea el documento; el «QR público» (capacidad
// content.public_qr) abre sin sesión únicamente ese documento, solo
// lectura. Se revoca en cualquier momento. El contador de escaneos no guarda quién ni desde dónde.
import { randomToken } from "../../lib/crypto.ts";
import type { Readable } from "node:stream";
import { contentToHtml, escapeHtml } from "@spiderfolio/content";
import type { JSONContent } from "@tiptap/core";
import type { Env } from "../../config/env.ts";
import { forTenant } from "../../db/tenant.ts";
import { AppError, forbidden, notFound, unauthenticated } from "../../lib/errors.ts";
import type { PrismaClient } from "../../lib/prisma.ts";
import type { Storage } from "../../lib/storage.ts";
import { loadTenantContext } from "../../middleware/tenant.ts";
import { atLeast } from "../access/access.ts";
import { levelOfNode, requireLevel } from "../access/access-context.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { publishedFileVersionOf } from "../documents/controlled-guard.ts";
import { renderLabelsPdf, type LabelSize } from "./labels.ts";
import { renderPng, renderSvg } from "./qr-render.ts";
import { currentLocale } from "../../i18n/locales.ts";
import { qrTexts } from "../../i18n/index.ts";

export interface QrDeps {
  env: Pick<Env, "APP_URL">;
}

export interface QrView {
  id: string;
  isPublic: boolean;
  /** La dirección que lleva el código. */
  url: string;
  scans: number;
  lastScanAt: Date | null;
  createdAt: Date;
  revokedAt: Date | null;
}

export interface QrList {
  items: QrView[];
  /** Puede generar un QR público (capacidad, función del plan y gestionar el documento). */
  canPublic: boolean;
}

const urlOf = (deps: Pick<QrDeps, "env">, token: string): string =>
  `${deps.env.APP_URL.replace(/\/$/u, "")}/q/${token}`;

const viewOf = (deps: Pick<QrDeps, "env">, row: QrRow): QrView => ({
  id: row.id,
  isPublic: row.isPublic,
  url: urlOf(deps, row.token),
  scans: row.scans,
  lastScanAt: row.lastScanAt,
  createdAt: row.createdAt,
  revokedAt: row.revokedAt,
});

interface QrRow {
  id: string;
  token: string;
  isPublic: boolean;
  scans: number;
  lastScanAt: Date | null;
  createdAt: Date;
  revokedAt: Date | null;
  createdById: string;
  nodeId: string;
}

const qrSelect = {
  id: true,
  token: true,
  isPublic: true,
  scans: true,
  lastScanAt: true,
  createdAt: true,
  revokedAt: true,
  createdById: true,
  nodeId: true,
} as const;

/** El documento: página o archivo, no en la papelera. */
async function documentNode(ctx: AdminContext, nodeId: string) {
  const node = await ctx.db.node.findFirst({
    where: { id: nodeId, trashedAt: null },
    select: { id: true, name: true, type: true, spaceId: true },
  });
  if (node === null) throw notFound();
  if (node.type === "FOLDER") {
    throw new AppError("BAD_REQUEST", { message: qrTexts.onlyDocuments });
  }
  return node;
}

export async function listQr(ctx: AdminContext, deps: QrDeps, nodeId: string): Promise<QrList> {
  await documentNode(ctx, nodeId);
  const level = requireLevel(await levelOfNode(ctx, nodeId), "EDIT");
  const rows = await ctx.db.qrCode.findMany({
    where: { nodeId },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: 100,
    select: qrSelect,
  });
  return {
    items: rows.map((row) => viewOf(deps, row)),
    canPublic:
      atLeast(level, "MANAGE") &&
      ctx.actor.capabilities.includes("content.public_qr"),
  };
}

export async function createQr(
  ctx: AdminContext,
  deps: QrDeps,
  nodeId: string,
  input: { public: boolean },
): Promise<QrView> {
  await documentNode(ctx, nodeId);
  const level = requireLevel(await levelOfNode(ctx, nodeId), "EDIT");
  if (input.public) {
    // Abre el documento a cualquiera que tenga el código: solo quien lo gestiona y con permiso.
    if (!atLeast(level, "MANAGE") || !ctx.actor.capabilities.includes("content.public_qr")) {
      throw forbidden();
    }
  }
  const row = await ctx.db.$transaction(async (tx) => {
    const created = await tx.qrCode.create({
      data: {
        nodeId,
        token: randomToken(16),
        isPublic: input.public,
        createdById: ctx.tenant.membershipId,
      },
      select: qrSelect,
    });
    await auditAdmin(
      { db: tx, info: ctx.info },
      {
        action: "qr.create",
        entityType: "Node",
        entityId: nodeId,
        metadata: { qrId: created.id, public: input.public },
      },
    );
    return created;
  });
  return viewOf(deps, row);
}

async function loadQr(ctx: AdminContext, qrId: string): Promise<QrRow> {
  const row = await ctx.db.qrCode.findFirst({ where: { id: qrId }, select: qrSelect });
  if (row === null) throw notFound();
  return row;
}

/** Revoca el código: deja de abrir desde ese momento. Quien lo generó o quien gestiona el documento. */
export async function revokeQr(ctx: AdminContext, qrId: string): Promise<void> {
  const row = await loadQr(ctx, qrId);
  await documentNode(ctx, row.nodeId);
  const level = requireLevel(await levelOfNode(ctx, row.nodeId), "EDIT");
  if (row.createdById !== ctx.tenant.membershipId && !atLeast(level, "MANAGE")) throw forbidden();
  if (row.revokedAt !== null) return;
  await ctx.db.$transaction(async (tx) => {
    await tx.qrCode.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
    await auditAdmin(
      { db: tx, info: ctx.info },
      {
        action: "qr.revoke",
        entityType: "Node",
        entityId: row.nodeId,
        metadata: { qrId: row.id, public: row.isPublic },
      },
    );
  });
}

/** La imagen del código (PNG o SVG) para descargar. */
export async function qrImage(
  ctx: AdminContext,
  deps: QrDeps,
  qrId: string,
  format: "png" | "svg",
): Promise<{ body: Buffer | string; contentType: string; fileName: string }> {
  const row = await loadQr(ctx, qrId);
  const node = await documentNode(ctx, row.nodeId);
  requireLevel(await levelOfNode(ctx, row.nodeId), "EDIT");
  const url = urlOf(deps, row.token);
  const base = qrTexts.imageFileName(node.name).slice(0, 80);
  return format === "png"
    ? { body: renderPng(url), contentType: "image/png", fileName: `${base}.png` }
    : { body: renderSvg(url), contentType: "image/svg+xml", fileName: `${base}.svg` };
}

/** La hoja de etiquetas A4: QR, código, título y área, en el tamaño pedido. */
export async function qrLabels(
  ctx: AdminContext,
  deps: QrDeps,
  qrId: string,
  size: LabelSize,
): Promise<{ bytes: Uint8Array; fileName: string }> {
  const row = await loadQr(ctx, qrId);
  const node = await documentNode(ctx, row.nodeId);
  requireLevel(await levelOfNode(ctx, row.nodeId), "EDIT");
  const [controlled, space] = await Promise.all([
    ctx.db.controlledDocument.findFirst({
      where: { nodeId: node.id },
      select: { code: true, ownerDepartmentId: true },
    }),
    ctx.db.space.findFirst({
      where: { id: node.spaceId },
      select: { name: true, departmentId: true },
    }),
  ]);
  const departmentId = controlled?.ownerDepartmentId ?? space?.departmentId ?? null;
  const department =
    departmentId === null
      ? null
      : await ctx.db.department.findFirst({ where: { id: departmentId }, select: { name: true } });
  const bytes = await renderLabelsPdf({
    url: urlOf(deps, row.token),
    code: controlled?.code ?? null,
    title: node.name,
    area: department?.name ?? space?.name ?? null,
    size,
  });
  return { bytes, fileName: qrTexts.labelsFileName(controlled?.code ?? node.name).slice(0, 80) + ".pdf" };
}

// ─── Al escanear ─────────────────────────────────────────────────────────────────────────

export type ScanResult =
  | {
      kind: "private";
      workspaceSlug: string;
      spaceId: string;
      nodeId: string;
      nodeType: "PAGE" | "FILE";
    }
  | { kind: "public-page"; title: string; html: string }
  | {
      kind: "public-file";
      title: string;
      fileName: string;
      contentType: string;
      /** Dirección temporal de descarga del archivo vigente. */
      url: string;
    };

const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const MAX_IMAGES_TOTAL = 12 * 1024 * 1024;

async function toBuffer(stream: Readable, max: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    size += part.length;
    if (size > max) throw new Error("too large");
    chunks.push(part);
  }
  return Buffer.concat(chunks);
}

const PUBLIC_STYLE = `body{font-family:system-ui,Helvetica,Arial,sans-serif;line-height:1.55;color:#1a1a1a;margin:0;padding:16px;max-width:760px;margin-inline:auto}
h1{font-size:1.7rem}h2{font-size:1.3rem}h3{font-size:1.1rem}img{max-width:100%}table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;padding:4px 8px;vertical-align:top}
blockquote{margin:.6em 0;padding-left:1em;border-left:3px solid #bbb;color:#444}pre{background:#f3f3f3;padding:8px;white-space:pre-wrap}.missing{color:#777;font-style:italic}`;

/**
 * Resuelve el código escaneado. Un código inexistente o revocado es un 404 (no se distingue). El
 * privado pide sesión (401 → el navegador va al inicio de sesión) y que la persona vea el
 * documento; el público devuelve únicamente ese documento, en lectura.
 */
export async function scanQr(
  deps: {
    prisma: PrismaClient;
    storage: Storage;
  },
  token: string,
  userId: string | null,
): Promise<ScanResult> {
  const row = await deps.prisma.qrCode.findUnique({
    where: { token },
    select: { id: true, workspaceId: true, nodeId: true, isPublic: true, revokedAt: true },
  });
  if (row === null || row.revokedAt !== null) throw notFound();
  const db = forTenant(deps.prisma, row.workspaceId);
  const node = await db.node.findFirst({
    where: { id: row.nodeId, trashedAt: null },
    select: { id: true, name: true, type: true, spaceId: true },
  });
  if (node === null || node.type === "FOLDER") throw notFound();
  const count = () =>
    db.qrCode.updateMany({
      where: { id: row.id, revokedAt: null },
      data: { scans: { increment: 1 }, lastScanAt: new Date() },
    });

  if (!row.isPublic) {
    if (userId === null) throw unauthenticated();
    const loaded = await loadTenantContext(deps.prisma, { id: row.workspaceId }, userId);
    if (loaded === null) throw notFound();
    const ctx: AdminContext = {
      db: loaded.db,
      tenant: loaded.tenant,
      actor: { base: loaded.tenant.role.base, capabilities: loaded.tenant.capabilities },
      info: { actorId: userId, ip: null, userAgent: null },
    };
    if (!atLeast(await levelOfNode(ctx, node.id), "VIEW")) throw notFound();
    await count();
    return {
      kind: "private",
      workspaceSlug: loaded.tenant.workspaceSlug,
      spaceId: node.spaceId,
      nodeId: node.id,
      nodeType: node.type,
    };
  }

  if (node.type === "FILE") {
    const published = await publishedFileVersionOf(db, node.id);
    const current = await db.node.findFirst({
      where: { id: node.id },
      select: { currentVersion: true },
    });
    const version = await db.fileVersion.findFirst({
      where: {
        nodeId: node.id,
        version: published ?? current?.currentVersion ?? 0,
        purgedAt: null,
      },
    });
    if (version === null) throw notFound();
    const url = await deps.storage.presignGet(version.storageKey, {
      fileName: version.fileName,
      inline: false,
      contentType: version.mimeType,
    });
    await count();
    return {
      kind: "public-file",
      title: node.name,
      fileName: version.fileName,
      contentType: version.mimeType,
      url,
    };
  }

  // Página: la versión vigente si es controlada; si no, el texto actual.
  const snapshot = await db.documentVersion.findFirst({
    where: { nodeId: node.id, status: "PUBLISHED" },
    select: { content: true },
  });
  const controlled = await db.controlledDocument.findFirst({
    where: { nodeId: node.id },
    select: { id: true },
  });
  if (controlled !== null && (snapshot === null || snapshot.content === null)) throw notFound();
  const content =
    snapshot?.content ?? (await db.pageContent.findFirst({ where: { nodeId: node.id } }))?.content;
  if (content === undefined || content === null) throw notFound();
  const images = new Map<string, string>();
  const rows = await db.pageImage.findMany({
    where: { nodeId: node.id, confirmedAt: { not: null } },
    select: { id: true, storageKey: true, mimeType: true, sizeBytes: true },
  });
  let budget = MAX_IMAGES_TOTAL;
  for (const image of rows) {
    const size = Number(image.sizeBytes);
    if (size > MAX_IMAGE_BYTES || size > budget) continue;
    try {
      const data = await toBuffer(await deps.storage.stream(image.storageKey), MAX_IMAGE_BYTES);
      budget -= data.length;
      images.set(image.id, `data:${image.mimeType};base64,${data.toString("base64")}`);
    } catch {
      // Una imagen que no se puede leer queda como «[Imagen]».
    }
  }
  const body = contentToHtml(content as JSONContent, { imageSrc: (id) => images.get(id) ?? null });
  const html = `<!doctype html><html lang="${currentLocale()}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(node.name)}</title><style>${PUBLIC_STYLE}</style></head><body><h1>${escapeHtml(node.name)}</h1>${body}</body></html>`;
  await count();
  return { kind: "public-page", title: node.name, html };
}
