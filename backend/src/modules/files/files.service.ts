// Archivos (docs/spec/archivos.md, sección 11): subida directa a S3 con URL prefirmada, cuota con
// reservas, verificación del contenido real al confirmar, y descarga con URL de 60 s tras
// resolveAccess. Nada de esto toca el objeto antes de que quien pide tenga el permiso: el nodo
// nuevo recién se crea al confirmar (no quedan archivos fantasma si la subida se corta).
import { createHash, randomUUID } from "node:crypto";
import type { Jobs } from "../../jobs/boss.ts";
import { isExtractable } from "../search/text-extract.ts";
import { trashOldVersions, versionsKept } from "./version-retention.ts";
import { ensureDraftVersion, publishedFileVersionOf } from "../documents/controlled-guard.ts";
import type { Readable } from "node:stream";
import { bytesToJson } from "@spiderfolio/limits";
import type { Prisma } from "../../generated/prisma/client.ts";
import { contentMessages, fileMessages } from "../../i18n/index.ts";
import { AppError, notFound } from "../../lib/errors.ts";
import {
  INSPECT_BYTES,
  inspectContent,
  kindOfContentType,
  kindOfFileName,
  type FileKind,
} from "../../lib/file-types.ts";
import { cleanName, nameKeyOf, numberedName } from "../../lib/names.ts";
import {
  DOWNLOAD_URL_TTL_SECONDS,
  newStorageKey,
  UPLOAD_URL_TTL_SECONDS,
  type Storage,
} from "../../lib/storage.ts";
import { positionBetween } from "../../lib/position.ts";
import { levelOfNode, requireLevel } from "../access/access-context.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { assertWithinLimit, workspaceLimits } from "../limits/limits.service.ts";
import { assertDestination, nodeSelect, toView, type NodeView } from "../nodes/nodes.service.ts";
import { offsetArgs, pageOf, type Page } from "../../lib/pagination.ts";
import { assertSpaceWritable } from "../spaces/spaces.service.ts";
import type { DownloadQuery, ListVersionsQuery, StartUploadInput } from "./files.schemas.ts";

/** Desde este tamaño se sube por partes (con reanudación). */
export const MULTIPART_THRESHOLD_BYTES = 100 * 1024 * 1024;
export const PART_SIZE_BYTES = 16 * 1024 * 1024;
/** Las reservas de cuota vencen a la hora (9A.4). */
export const RESERVATION_TTL_MS = 60 * 60 * 1000;

export interface FileDeps {
  storage: Storage;
  /** Para encolar la extracción de texto de un PDF o DOCX recién subido. */
  jobs?: Pick<Jobs, "enqueue">;
  /** Solo para pruebas: umbral y tamaño de parte más chicos que los de producción. */
  multipartThresholdBytes?: number;
  partSizeBytes?: number;
}

export interface UploadTicket {
  id: string;
  /** El archivo que se va a crear o al que se le suma una versión. */
  nodeId: string;
  name: string;
  version: number;
  size: number;
  expiresAt: Date;
  /** Cabecera Content-Type que hay que mandar tal cual (va firmada). */
  contentType: string;
  /** Una sola URL PUT, o por partes. */
  mode: "single" | "multipart";
  url: string | null;
  partSize: number | null;
  partCount: number | null;
}

/**
 * Tamaño de archivo y cuota de almacenamiento, si la empresa los fijó (docs/spec/limites.md): usado +
 * reservado + nuevo <= límite. Se llama dentro de la transacción que ya tomó el candado del workspace.
 */
async function assertQuota(
  ctx: AdminContext,
  bytes: bigint,
  now: Date,
): Promise<void> {
  const limits = await workspaceLimits(ctx.db);
  await assertWithinLimit(ctx.db, "maxFileMb", { used: 0, requested: bytes }, limits);
  await assertStorageRoom(ctx.db, bytes, now, limits);
}

/**
 * Cuota de almacenamiento (9A.4): usado + reservado + nuevo <= límite. La usan las subidas, el
 * plan de importación de carpetas y la descompresión de ZIP (en el worker).
 */
export async function assertStorageRoom(
  db: AdminContext["db"],
  bytes: bigint,
  now: Date = new Date(),
  known?: Awaited<ReturnType<typeof workspaceLimits>>,
): Promise<void> {
  const limits = known ?? (await workspaceLimits(db));
  // Sin cuota fijada no hace falta sumar nada.
  if (limits.storageGb === null) return;
  const workspace = await db.workspace.findFirstOrThrow({
    where: {},
    select: { storageUsedBytes: true },
  });
  const sum = await db.uploadReservation.aggregate({
    where: { expiresAt: { gt: now } },
    _sum: { bytes: true },
  });
  // Las imágenes de páginas que se pidieron y todavía no se confirmaron también reservan lugar.
  const pendingImages = await db.pageImage.aggregate({
    where: { confirmedAt: null, createdAt: { gt: new Date(now.getTime() - RESERVATION_TTL_MS) } },
    _sum: { sizeBytes: true },
  });
  await assertWithinLimit(
    db,
    "storageGb",
    {
      used: workspace.storageUsedBytes,
      reserved: (sum._sum.bytes ?? 0n) + (pendingImages._sum.sizeBytes ?? 0n),
      requested: bytes,
    },
    limits,
  );
}

/** Serializa los cambios de cuota del workspace (candado de fila hasta el fin de la transacción). */
export async function lockWorkspace(db: AdminContext["db"]): Promise<void> {
  const workspace = await db.workspace.findFirstOrThrow({ where: {}, select: { id: true } });
  await db.workspace.update({
    where: { id: workspace.id },
    data: { storageUsedBytes: { increment: 0 } },
  });
}

function typeError(reason: "mismatch" | "binary" | "markup"): AppError {
  const message =
    reason === "markup"
      ? fileMessages.markup
      : reason === "binary"
        ? fileMessages.binaryText
        : fileMessages.contentMismatch;
  return new AppError("BAD_REQUEST", { message });
}

// ─── Pedir permiso para subir ───────────────────────────────────────────────────────────

export async function startUpload(
  ctx: AdminContext,
  deps: FileDeps,
  spaceId: string,
  input: StartUploadInput,
): Promise<UploadTicket> {
  const parentId = input.parentId ?? null;
  const name = cleanName(input.name);
  const kind = kindOfFileName(name);
  if (kind === null) throw new AppError("BAD_REQUEST", { message: fileMessages.unsupportedType });
  await assertDestination(ctx, spaceId, parentId);

  const now = new Date();
  const bytes = BigInt(input.size);
  const sibling = await ctx.db.node.findFirst({
    where: { spaceId, parentId, nameKey: nameKeyOf(name), trashedAt: null },
    select: { id: true, type: true, name: true, currentVersion: true },
  });

  let nodeId: string = randomUUID();
  let isNewNode = true;
  let version = 1;
  let finalName = name;
  if (sibling !== null) {
    if (input.onConflict === "replace" && sibling.type === "FILE") {
      // Una versión nueva del archivo que ya está: hace falta poder editarlo.
      requireLevel(await levelOfNode(ctx, sibling.id), "EDIT");
      nodeId = sibling.id;
      isNewNode = false;
      // Siguiente al número más alto que existió (restaurar una versión mueve el puntero, no borra).
      version = (await maxVersion(ctx, sibling.id)) + 1;
    } else if (input.onConflict === "keep_both") {
      finalName = await freeName(ctx, spaceId, parentId, name);
    } else {
      throw new AppError("CONFLICT", {
        message: contentMessages.nameTaken,
        details: { existing: { id: sibling.id, type: sibling.type, name: sibling.name } },
      });
    }
  }

  const storageKey = newStorageKey(ctx.tenant.workspaceId, nodeId, version);
  const partSize = deps.partSizeBytes ?? PART_SIZE_BYTES;
  const multipart = bytes > BigInt(deps.multipartThresholdBytes ?? MULTIPART_THRESHOLD_BYTES);
  const expiresAt = new Date(now.getTime() + RESERVATION_TTL_MS);

  const reservation = await ctx.db.$transaction(async (tx) => {
    const scoped = { ...ctx, db: tx };
    await lockWorkspace(tx);
    await assertQuota(scoped, bytes, now);
    return await tx.uploadReservation.create({
      data: {
        bytes,
        expiresAt,
        createdById: ctx.tenant.membershipId,
        spaceId,
        parentId,
        nodeId,
        isNewNode,
        version,
        name: finalName,
        conflict: input.onConflict === "keep_both" ? "keep_both" : "reject",
        storageKey,
        mimeType: kind.contentType,
        partSize: multipart ? partSize : null,
      },
      select: { id: true },
    });
  });

  try {
    let multipartId: string | null = null;
    if (multipart) {
      multipartId = await deps.storage.createMultipart(storageKey, kind.contentType);
      await ctx.db.uploadReservation.update({
        where: { id: reservation.id },
        data: { multipartId },
      });
    }
    const url = multipart
      ? null
      : await deps.storage.presignPut(storageKey, {
          size: input.size,
          contentType: kind.contentType,
        });
    return {
      id: reservation.id,
      nodeId,
      name: finalName,
      version,
      size: input.size,
      expiresAt,
      contentType: kind.contentType,
      mode: multipart ? "multipart" : "single",
      url,
      partSize: multipart ? partSize : null,
      partCount: multipart ? Math.ceil(input.size / partSize) : null,
    };
  } catch (error) {
    // Sin la URL la reserva no sirve: se libera la cuota.
    await ctx.db.uploadReservation.deleteMany({ where: { id: reservation.id } });
    throw error;
  }
}

/** El número de versión más alto que tuvo el archivo (incluidas las ya purgadas). */
async function maxVersion(ctx: Pick<AdminContext, "db">, nodeId: string): Promise<number> {
  const result = await ctx.db.fileVersion.aggregate({ where: { nodeId }, _max: { version: true } });
  return result._max.version ?? 0;
}

/** "Informe.pdf" → "Informe (2).pdf" → … hasta encontrar un nombre libre entre los hermanos. */
async function freeName(
  ctx: Pick<AdminContext, "db">,
  spaceId: string,
  parentId: string | null,
  name: string,
): Promise<string> {
  for (let n = 2; n < 1000; n++) {
    const candidate = numberedName(name, n);
    const taken = await ctx.db.node.count({
      where: { spaceId, parentId, nameKey: nameKeyOf(candidate), trashedAt: null },
    });
    if (taken === 0) return candidate;
  }
  throw new AppError("CONFLICT", { message: contentMessages.nameTaken });
}

// ─── Reservas ─────────────────────────────────────────────────────────────────────────────

/** Una reserva propia y vigente; la de otra persona (o de otro workspace) no existe. */
async function ownReservation(ctx: AdminContext, id: string, now = new Date()) {
  const row = await ctx.db.uploadReservation.findFirst({
    where: { id, createdById: ctx.tenant.membershipId },
  });
  if (row === null) throw notFound();
  // Vencida: el job de limpieza aborta lo subido y libera la cuota.
  if (row.expiresAt <= now) {
    throw new AppError("CONFLICT", { message: fileMessages.uploadExpired });
  }
  return row;
}

export async function uploadStatus(
  ctx: AdminContext,
  deps: FileDeps,
  id: string,
): Promise<{
  ticket: UploadTicket;
  uploadedParts: { partNumber: number; size: number }[];
}> {
  const row = await ownReservation(ctx, id);
  const multipart = row.multipartId !== null;
  const size = bytesToJson(row.bytes);
  const parts = multipart
    ? (await deps.storage.listParts(row.storageKey, row.multipartId ?? "")).map((part) => ({
        partNumber: part.partNumber,
        size: part.size,
      }))
    : [];
  const url = multipart
    ? null
    : await deps.storage.presignPut(row.storageKey, { size, contentType: row.mimeType });
  return {
    ticket: {
      id: row.id,
      nodeId: row.nodeId,
      name: row.name,
      version: row.version,
      size,
      expiresAt: row.expiresAt,
      contentType: row.mimeType,
      mode: multipart ? "multipart" : "single",
      url,
      partSize: row.partSize,
      partCount: row.partSize === null ? null : Math.ceil(size / row.partSize),
    },
    uploadedParts: parts,
  };
}

export async function partUrls(
  ctx: AdminContext,
  deps: FileDeps,
  id: string,
  partNumbers: readonly number[],
): Promise<{ partNumber: number; url: string }[]> {
  const row = await ownReservation(ctx, id);
  if (row.multipartId === null || row.partSize === null) {
    throw new AppError("BAD_REQUEST", { message: fileMessages.partsIncomplete });
  }
  const count = Math.ceil(bytesToJson(row.bytes) / row.partSize);
  if (partNumbers.some((n) => n > count)) {
    throw new AppError("BAD_REQUEST", { message: fileMessages.partsIncomplete });
  }
  const multipartId = row.multipartId;
  return await Promise.all(
    partNumbers.map(async (partNumber) => ({
      partNumber,
      url: await deps.storage.presignPart(row.storageKey, multipartId, partNumber),
    })),
  );
}

export async function abortUpload(ctx: AdminContext, deps: FileDeps, id: string): Promise<void> {
  const row = await ctx.db.uploadReservation.findFirst({
    where: { id, createdById: ctx.tenant.membershipId },
  });
  if (row === null) throw notFound();
  await discardObject(deps.storage, row);
  await ctx.db.uploadReservation.deleteMany({ where: { id } });
}

/** Borra lo que se haya subido de esa reserva (objeto entero o subida por partes a medias). */
export async function discardObject(
  storage: Storage,
  row: { storageKey: string; multipartId: string | null },
): Promise<void> {
  if (row.multipartId !== null) await storage.abortMultipart(row.storageKey, row.multipartId);
  await storage.delete(row.storageKey);
}

// ─── Confirmar ────────────────────────────────────────────────────────────────────────────

interface ObjectScan {
  head: Buffer;
  size: number;
  sha256: string;
}

/** Lee el objeto una sola vez: calcula el SHA-256 y se queda con el principio para inspeccionarlo. */
async function scan(stream: Readable): Promise<ObjectScan> {
  const hash = createHash("sha256");
  const head: Buffer[] = [];
  let headBytes = 0;
  let size = 0;
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    hash.update(chunk);
    size += chunk.length;
    if (headBytes < INSPECT_BYTES) {
      const slice = chunk.subarray(0, INSPECT_BYTES - headBytes);
      head.push(slice);
      headBytes += slice.length;
    }
  }
  return { head: Buffer.concat(head), size, sha256: hash.digest("hex") };
}

export interface UploadResult {
  node: NodeView;
  version: { version: number; sizeBytes: number; checksum: string };
  /** Otra versión (o archivo) con el mismo contenido (mismo SHA-256) en el workspace. */
  duplicateOf: string | null;
}

export async function completeUpload(
  ctx: AdminContext,
  deps: FileDeps,
  id: string,
): Promise<UploadResult> {
  const row = await ownReservation(ctx, id);
  const kind = kindOfFileName(row.name);
  if (kind === null) throw new AppError("BAD_REQUEST", { message: fileMessages.unsupportedType });
  // El permiso se vuelve a mirar: pudo cambiar mientras se subía.
  if (row.isNewNode) await assertDestination(ctx, row.spaceId, row.parentId);
  else requireLevel(await levelOfNode(ctx, row.nodeId), "EDIT");

  const fail = async (error: AppError): Promise<never> => {
    await discardObject(deps.storage, { storageKey: row.storageKey, multipartId: null });
    await ctx.db.uploadReservation.deleteMany({ where: { id } });
    throw error;
  };

  if (row.multipartId !== null) {
    const parts = await deps.storage.listParts(row.storageKey, row.multipartId);
    const total = parts.reduce((sum, part) => sum + part.size, 0);
    if (parts.length === 0 || total !== bytesToJson(row.bytes)) {
      throw new AppError("BAD_REQUEST", { message: fileMessages.partsIncomplete });
    }
    await deps.storage.completeMultipart(row.storageKey, row.multipartId, parts);
  }
  const head = await deps.storage.head(row.storageKey);
  if (head === null) throw new AppError("BAD_REQUEST", { message: fileMessages.notReceived });
  if (BigInt(head.size) !== row.bytes) {
    return await fail(new AppError("BAD_REQUEST", { message: fileMessages.sizeMismatch }));
  }
  const scanned = await scan(await deps.storage.stream(row.storageKey));
  if (BigInt(scanned.size) !== row.bytes) {
    return await fail(new AppError("BAD_REQUEST", { message: fileMessages.sizeMismatch }));
  }
  const verdict = await inspectContent(kind, scanned.head);
  if (!verdict.ok) return await fail(typeError(verdict.reason));

  let result: UploadResult;
  try {
    result = await ctx.db.$transaction(async (tx) => {
      await lockWorkspace(tx);
      const scoped = { ...ctx, db: tx };
      let name = row.name;
      let position: string | undefined;
      if (row.isNewNode) {
        const clash = await tx.node.findFirst({
          where: {
            spaceId: row.spaceId,
            parentId: row.parentId,
            nameKey: nameKeyOf(name),
            trashedAt: null,
          },
          select: { id: true },
        });
        if (clash !== null) {
          // Alguien tomó el nombre mientras se subía.
          if (row.conflict !== "keep_both") {
            throw new AppError("CONFLICT", { message: contentMessages.nameTaken });
          }
          name = await freeName(scoped, row.spaceId, row.parentId, row.name);
        }
        const last = await tx.node.findFirst({
          where: { spaceId: row.spaceId, parentId: row.parentId },
          orderBy: { position: "desc" },
          select: { position: true },
        });
        position = positionBetween(last?.position ?? null, null);
      } else {
        const current = await tx.node.findFirst({
          where: { id: row.nodeId, trashedAt: null },
          select: { id: true },
        });
        if (current === null) throw notFound();
        // Otra subida de una versión nueva terminó antes: el número ya está tomado.
        if ((await maxVersion({ db: tx }, row.nodeId)) + 1 !== row.version) {
          throw new AppError("CONFLICT", { message: contentMessages.nameTaken });
        }
        // Documento controlado: una versión nueva entra como borrador (o se rechaza si está en revisión).
        await ensureDraftVersion(tx, ctx.tenant.membershipId, row.nodeId, {
          fileVersion: row.version,
        });
      }
      const node = row.isNewNode
        ? await tx.node.create({
            data: {
              id: row.nodeId,
              spaceId: row.spaceId,
              parentId: row.parentId,
              type: "FILE",
              name,
              nameKey: nameKeyOf(name),
              position: position ?? "V",
              currentVersion: row.version,
              mimeType: kind.contentType,
              sizeBytes: row.bytes,
              createdById: ctx.tenant.membershipId,
              updatedById: ctx.tenant.membershipId,
            },
            select: nodeSelect,
          })
        : await tx.node.update({
            where: { id: row.nodeId },
            data: {
              currentVersion: row.version,
              mimeType: kind.contentType,
              sizeBytes: row.bytes,
              updatedById: ctx.tenant.membershipId,
            },
            select: nodeSelect,
          });
      const duplicate = await tx.fileVersion.findFirst({
        where: { checksum: scanned.sha256, purgedAt: null },
        select: { nodeId: true },
      });
      await tx.fileVersion.create({
        data: {
          nodeId: row.nodeId,
          version: row.version,
          storageKey: row.storageKey,
          fileName: name,
          mimeType: kind.contentType,
          sizeBytes: row.bytes,
          checksum: scanned.sha256,
          uploadedById: ctx.tenant.membershipId,
        },
      });
      const workspace = await tx.workspace.findFirstOrThrow({ where: {}, select: { id: true } });
      await tx.workspace.update({
        where: { id: workspace.id },
        data: { storageUsedBytes: { increment: row.bytes } },
      });
      await tx.uploadReservation.delete({ where: { id } });
      await auditAdmin(
        { db: tx, info: ctx.info },
        {
          action: "file.upload",
          entityType: "Node",
          entityId: row.nodeId,
          metadata: {
            spaceId: row.spaceId,
            version: row.version,
            sizeBytes: bytesToJson(row.bytes),
            newFile: row.isNewNode,
          },
        },
      );
      const level = (await levelOfNode({ ...ctx, db: tx }, node.id)) ?? "EDIT";
      return {
        node: toView(node, level),
        version: {
          version: row.version,
          sizeBytes: bytesToJson(row.bytes),
          checksum: scanned.sha256,
        },
        duplicateOf:
          duplicate !== null && duplicate.nodeId !== row.nodeId ? duplicate.nodeId : null,
      };
    });
  } catch (error) {
    if (error instanceof AppError && error.code === "CONFLICT") {
      await fail(error);
    }
    throw error;
  }
  // Versiones guardadas (si la empresa fijó un límite): la más antigua pasa a la papelera; un fallo acá no rompe la subida.
  if (!row.isNewNode) {
    await versionsKept(ctx.db)
      .then((keep) => trashOldVersions(ctx.db, row.nodeId, keep))
      .catch(() => undefined);
  }
  // El texto para la búsqueda se extrae en el worker: no demora ni rompe la subida.
  if (deps.jobs !== undefined && isExtractable(kind.contentType)) {
    await deps.jobs
      .enqueue("text-extract", {
        workspaceId: ctx.tenant.workspaceId,
        nodeId: row.nodeId,
        version: row.version,
      })
      .catch(() => undefined);
  }
  return result;
}

// ─── Descarga y vista previa ───────────────────────────────────────────────────────────

export interface DownloadTicket {
  url: string;
  expiresInSeconds: number;
  fileName: string;
  contentType: string;
  version: number;
  sizeBytes: number;
}

/** URL prefirmada de 60 s tras resolveAccess. En la vista previa solo PDF, imágenes y texto. */
export async function downloadFile(
  ctx: AdminContext,
  deps: FileDeps,
  nodeId: string,
  query: DownloadQuery,
): Promise<DownloadTicket> {
  const node = await ctx.db.node.findFirst({
    where: { id: nodeId, trashedAt: null },
    select: { id: true, type: true, currentVersion: true, spaceId: true },
  });
  if (node === null) throw notFound();
  requireLevel(await levelOfNode(ctx, nodeId), "VIEW");
  if (node.type !== "FILE") throw new AppError("BAD_REQUEST", { message: fileMessages.notAFile });
  const version = await ctx.db.fileVersion.findFirst({
    where: {
      nodeId,
      // En un documento controlado, lo que se descarga por defecto es la versión vigente.
      version:
        query.version ?? (await publishedFileVersionOf(ctx.db, nodeId)) ?? node.currentVersion,
      purgedAt: null,
      trashedAt: null,
    },
  });
  if (version === null) {
    throw new AppError("NOT_FOUND", { message: fileMessages.versionNotFound });
  }
  const kind: FileKind | null = kindOfContentType(version.mimeType);
  if (query.inline && kind?.preview == null) {
    throw new AppError("BAD_REQUEST", { message: fileMessages.previewNotAllowed });
  }
  const url = await deps.storage.presignGet(version.storageKey, {
    fileName: version.fileName,
    inline: query.inline,
    contentType: version.mimeType,
  });
  await auditAdmin(ctx, {
    action: "file.download",
    entityType: "Node",
    entityId: nodeId,
    metadata: { version: version.version, inline: query.inline } satisfies Prisma.InputJsonObject,
  });
  return {
    url,
    expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS,
    fileName: version.fileName,
    contentType: version.mimeType,
    version: version.version,
    sizeBytes: bytesToJson(version.sizeBytes),
  };
}

// ─── Versiones ───────────────────────────────────────────────────────────────────────────

export interface VersionView {
  version: number;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
  createdAt: Date;
  /** Quién la subió (null si ya no es parte del workspace). */
  uploadedBy: string | null;
  /** Es la versión vigente. */
  current: boolean;
}

async function loadFile(ctx: AdminContext, nodeId: string) {
  const node = await ctx.db.node.findFirst({
    where: { id: nodeId, trashedAt: null },
    select: { id: true, type: true, spaceId: true, currentVersion: true },
  });
  if (node === null) throw notFound();
  return node;
}

/** Historial del archivo, de la más nueva a la más vieja (VIEW alcanza). */
export async function listVersions(
  ctx: AdminContext,
  nodeId: string,
  query: ListVersionsQuery,
): Promise<Page<VersionView>> {
  const node = await loadFile(ctx, nodeId);
  requireLevel(await levelOfNode(ctx, nodeId), "VIEW");
  if (node.type !== "FILE") throw new AppError("BAD_REQUEST", { message: fileMessages.notAFile });
  const where = { nodeId, purgedAt: null, trashedAt: null };
  const [rows, total] = await Promise.all([
    ctx.db.fileVersion.findMany({
      where,
      orderBy: { version: "desc" },
      ...offsetArgs(query),
    }),
    ctx.db.fileVersion.count({ where }),
  ]);
  const people = await ctx.db.membership.findMany({
    where: { id: { in: [...new Set(rows.map((row) => row.uploadedById))] } },
    select: { id: true, user: { select: { name: true } } },
  });
  const names = new Map(people.map((person) => [person.id, person.user.name]));
  return pageOf(
    rows.map((row) => ({
      version: row.version,
      fileName: row.fileName,
      mimeType: row.mimeType,
      sizeBytes: bytesToJson(row.sizeBytes),
      checksum: row.checksum,
      createdAt: row.createdAt,
      uploadedBy: names.get(row.uploadedById) ?? null,
      current: row.version === node.currentVersion,
    })),
    total,
    query,
  );
}

/** Vuelve a una versión anterior: pasa a ser la vigente (no se copia ni se borra nada). */
export async function restoreVersion(
  ctx: AdminContext,
  nodeId: string,
  version: number,
): Promise<NodeView> {
  const node = await loadFile(ctx, nodeId);
  const level = requireLevel(await levelOfNode(ctx, nodeId), "EDIT");
  if (node.type !== "FILE") throw new AppError("BAD_REQUEST", { message: fileMessages.notAFile });
  await assertSpaceWritable(ctx, node.spaceId);
  const target = await ctx.db.fileVersion.findFirst({
    where: { nodeId, version, purgedAt: null, trashedAt: null },
  });
  if (target === null) {
    throw new AppError("NOT_FOUND", { message: fileMessages.versionNotFound });
  }
  if (node.currentVersion === version) {
    const row = await ctx.db.node.findFirstOrThrow({ where: { id: nodeId }, select: nodeSelect });
    return toView(row, level);
  }
  const updated = await ctx.db.$transaction(async (tx) => {
    await ensureDraftVersion(tx, ctx.tenant.membershipId, nodeId, { fileVersion: version });
    const row = await tx.node.update({
      where: { id: nodeId },
      data: {
        currentVersion: version,
        mimeType: target.mimeType,
        sizeBytes: target.sizeBytes,
        updatedById: ctx.tenant.membershipId,
      },
      select: nodeSelect,
    });
    await auditAdmin(
      { db: tx, info: ctx.info },
      {
        action: "file.restore_version",
        entityType: "Node",
        entityId: nodeId,
        metadata: { from: node.currentVersion, to: version },
      },
    );
    return row;
  });
  return toView(updated, level);
}

export { UPLOAD_URL_TTL_SECONDS };
