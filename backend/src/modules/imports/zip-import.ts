// Descompresión de un ZIP importado (worker, docs/spec/adopcion.md 9C.2). Cada entrada se valida
// (ruta, tipo, tamaño, proporción de compresión, cuota) antes de descomprimirse, y se sube a S3 en
// streaming con SHA-256 al pasar. Nada se sobrescribe: un nombre ocupado se omite. El resultado
// queda en ImportJob.summary para la pantalla.
import { createHash, randomUUID } from "node:crypto";
import { PassThrough, Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Logger } from "pino";
import type { Entry } from "yauzl";
import { checkLimit } from "@spiderfolio/limits";
import type { TenantDb } from "../../db/tenant.ts";
import { forTenant } from "../../db/tenant.ts";
import { ZipImportJobSchema } from "../../jobs/queues.ts";
import { AppError } from "../../lib/errors.ts";
import { INSPECT_BYTES, inspectContent, kindOfFileName } from "../../lib/file-types.ts";
import { cleanName, nameKeyOf, numberedName } from "../../lib/names.ts";
import type { PrismaClient } from "../../lib/prisma.ts";
import { newStorageKey, type Storage } from "../../lib/storage.ts";
import { audit } from "../audit/audit.service.ts";
import { workspaceLimits } from "../limits/limits.service.ts";
import { assertStorageRoom, lockWorkspace, RESERVATION_TTL_MS } from "../files/files.service.ts";
import { lastPosition, MAX_TREE_DEPTH } from "../nodes/nodes.service.ts";
import {
  BLOCKED,
  MAX_IMPORT_ENTRIES,
  parseImportPath,
  type ImportSkipReason,
} from "./import-paths.ts";
import { isSymlink, openZip } from "./zip-reader.ts";
import { fileMessages } from "../../i18n/index.ts";

export interface ZipImportDeps {
  prisma: PrismaClient;
  storage: Storage;
  logger: Logger;
}

export interface ImportSummary {
  imported: number;
  /** Cuántos se omitieron (la lista se corta en SKIPPED_LIST_CAP). */
  skippedCount: number;
  skipped: { path: string; reason: ImportSkipReason }[];
  /** Importados cuyo contenido ya existía en el workspace (mismo SHA-256). */
  duplicates: number;
  folders: number;
  bytes: number;
}

const SKIPPED_LIST_CAP = 200;
/** Proporción de compresión sospechosa (bomba de descompresión), solo desde 1 MiB descomprimido. */
const MAX_RATIO = 1000;
const RATIO_FROM_BYTES = 1024 * 1024;

/** Calcula el SHA-256 y se queda con el principio mientras el contenido pasa a S3. */
class Scanner extends Transform {
  readonly hash = createHash("sha256");
  readonly head: Buffer[] = [];
  private headBytes = 0;
  size = 0;

  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null, data?: Buffer) => void,
  ): void {
    this.hash.update(chunk);
    this.size += chunk.length;
    if (this.headBytes < INSPECT_BYTES) {
      const slice = chunk.subarray(0, INSPECT_BYTES - this.headBytes);
      this.head.push(slice);
      this.headBytes += slice.length;
    }
    callback(null, chunk);
  }
}

export async function runZipImport(
  deps: ZipImportDeps,
  payload: unknown,
): Promise<ImportSummary | null> {
  const { importId } = ZipImportJobSchema.parse(payload);
  const job = await deps.prisma.importJob.findUnique({ where: { id: importId } });
  if (job === null) return null;
  // Reclamo atómico: un job repetido no descomprime dos veces.
  const claimed = await deps.prisma.importJob.updateMany({
    where: { id: importId, status: "PENDING" },
    data: { status: "RUNNING", startedAt: new Date() },
  });
  if (claimed.count === 0) return null;

  const db = forTenant(deps.prisma, job.workspaceId);
  try {
    const summary = await extract(deps, db, job);
    await db.importJob.update({
      where: { id: importId },
      data: { status: "DONE", finishedAt: new Date(), summary: { ...summary } },
    });
    return summary;
  } catch (error) {
    deps.logger.error({ err: error, importId }, "Falló la importación de un ZIP");
    const message =
      error instanceof AppError ? error.message : fileMessages.importUnreadable;
    await db.importJob.update({
      where: { id: importId },
      data: { status: "FAILED", finishedAt: new Date(), error: message },
    });
    return null;
  }
}

interface Job {
  id: string;
  spaceId: string;
  parentId: string | null;
  nodeId: string;
  createdById: string;
  newFolder: boolean;
}

async function extract(deps: ZipImportDeps, db: TenantDb, job: Job): Promise<ImportSummary> {
  const space = await db.space.findFirst({
    where: { id: job.spaceId, archivedAt: null },
    select: { id: true },
  });
  if (space === null)
    throw new AppError("NOT_FOUND", { message: fileMessages.importSpaceGone });
  const zipNode = await db.node.findFirst({
    where: { id: job.nodeId, trashedAt: null, type: "FILE" },
    select: { name: true, currentVersion: true },
  });
  if (zipNode === null)
    throw new AppError("NOT_FOUND", { message: fileMessages.importZipGone });
  const version = await db.fileVersion.findFirst({
    where: { nodeId: job.nodeId, version: zipNode.currentVersion, purgedAt: null },
    select: { storageKey: true, sizeBytes: true },
  });
  if (version === null)
    throw new AppError("NOT_FOUND", { message: fileMessages.importZipGone });
  const membership = await db.membership.findFirst({
    where: { id: job.createdById },
    select: { userId: true },
  });

  // Profundidad del destino: la cadena de carpetas desde la raíz del espacio.
  let baseDepth = 0;
  if (job.parentId !== null) {
    let cursor: string | null = job.parentId;
    while (cursor !== null) {
      const folder: { parentId: string | null; trashedAt: Date | null } | null =
        await db.node.findFirst({
          where: { id: cursor, spaceId: job.spaceId },
          select: { parentId: true, trashedAt: true },
        });
      if (folder === null || folder.trashedAt !== null) {
        throw new AppError("NOT_FOUND", {
          message: fileMessages.importTargetGone,
        });
      }
      baseDepth++;
      cursor = folder.parentId;
    }
  }

  const limits = await workspaceLimits(db);
  const summary: ImportSummary = {
    imported: 0,
    skippedCount: 0,
    skipped: [],
    duplicates: 0,
    folders: 0,
    bytes: 0,
  };
  const skip = (path: string, reason: ImportSkipReason): void => {
    summary.skippedCount++;
    if (summary.skipped.length < SKIPPED_LIST_CAP) summary.skipped.push({ path, reason });
  };

  // Carpetas: se crean al hacer falta, bajo la raíz de la importación.
  const folderIds = new Map<string, string | typeof BLOCKED>();
  const createFolder = async (
    parent: string | null,
    name: string,
  ): Promise<string | typeof BLOCKED> =>
    await db.$transaction(async (tx) => {
      const existing = await tx.node.findFirst({
        where: {
          spaceId: job.spaceId,
          parentId: parent,
          nameKey: nameKeyOf(name),
          trashedAt: null,
        },
        select: { id: true, type: true },
      });
      if (existing !== null) return existing.type === "FOLDER" ? existing.id : BLOCKED;
      const folder = await tx.node.create({
        data: {
          spaceId: job.spaceId,
          parentId: parent,
          type: "FOLDER",
          name,
          nameKey: nameKeyOf(name),
          position: await lastPosition({ db: tx }, job.spaceId, parent),
          createdById: job.createdById,
          updatedById: job.createdById,
        },
        select: { id: true },
      });
      summary.folders++;
      return folder.id;
    });

  let rootId = job.parentId;
  if (job.newFolder) {
    const base = cleanName(zipNode.name.replace(/\.zip$/i, "")) || fileMessages.importFolderName;
    // Una carpeta nueva de verdad: si el nombre está tomado, se numera.
    let name = base;
    for (let n = 2; n < 1000; n++) {
      const taken = await db.node.count({
        where: {
          spaceId: job.spaceId,
          parentId: job.parentId,
          nameKey: nameKeyOf(name),
          trashedAt: null,
        },
      });
      if (taken === 0) break;
      name = numberedName(base, n);
    }
    const created = await createFolder(job.parentId, name);
    if (created === BLOCKED)
      throw new AppError("CONFLICT", { message: fileMessages.importFolderFailed });
    rootId = created;
  }
  // Un ZIP con una sola carpeta en la raíz se importa sin esa carpeta: su contenido entra directo
  // (en el destino o en la carpeta nueva), sin repetir un nivel.
  const rootProbe = await openZip(deps.storage, version.storageKey, Number(version.sizeBytes));
  const stripRoot = await singleRootOf(rootProbe).finally(() => {
    rootProbe.close();
  });
  const maxDirs =
    MAX_TREE_DEPTH - baseDepth - (job.newFolder ? 1 : 0) + (stripRoot === null ? 0 : 1);

  const zip = await openZip(deps.storage, version.storageKey, Number(version.sizeBytes));
  try {
    let seen = 0;
    for await (const entry of zip.eachEntry()) {
      const fullName = entry.fileNameRaw.toString("utf8");
      if (fullName.endsWith("/")) continue; // las carpetas se crean con sus archivos
      if (stripRoot !== null && !fullName.startsWith(`${stripRoot}/`)) continue; // metadatos (__MACOSX…)
      const rawName = stripRoot === null ? fullName : fullName.slice(stripRoot.length + 1);
      if (++seen > MAX_IMPORT_ENTRIES) {
        skip("…", "tooMany");
        break;
      }
      const parsed = parseImportPath(rawName, maxDirs);
      if (!parsed.ok) {
        skip(rawName, parsed.reason);
        continue;
      }
      const kind = kindOfFileName(parsed.name);
      const size = entry.uncompressedSize;
      if (entry.isEncrypted() || !entry.canDecodeFileData()) {
        skip(rawName, entry.isEncrypted() ? "encrypted" : "unsupportedType");
      } else if (isSymlink(entry)) {
        skip(rawName, "symlink");
      } else if (kind === null) {
        skip(rawName, "unsupportedType");
      } else if (size === 0) {
        skip(rawName, "empty");
      } else if (
        size >= RATIO_FROM_BYTES &&
        entry.compressedSize > 0 &&
        size / entry.compressedSize > MAX_RATIO
      ) {
        skip(rawName, "suspiciousRatio");
      } else if (
        !checkLimit(limits, "maxFileMb", { used: 0, requested: BigInt(size) }).ok
      ) {
        skip(rawName, "tooLarge");
      } else {
        await importEntry(deps, db, job, zip, entry, parsed, kind.contentType, {
          rootId,
          folderIds,
          createFolder,
          summary,
          skip,
          path: rawName,
        });
      }
    }
  } finally {
    zip.close();
  }

  await audit(db, {
    actorId: membership?.userId ?? null,
    action: "import.zip",
    entityType: "Node",
    entityId: job.nodeId,
    metadata: {
      importId: job.id,
      imported: summary.imported,
      skipped: summary.skippedCount,
      folders: summary.folders,
      bytes: summary.bytes,
    },
  });
  return summary;
}

const METADATA_DIRS = new Set(["__MACOSX"]);

/** La única carpeta de la raíz del ZIP, o null si hay archivos sueltos o más de una carpeta. */
async function singleRootOf(zip: Awaited<ReturnType<typeof openZip>>): Promise<string | null> {
  let root: string | null = null;
  for await (const entry of zip.eachEntry()) {
    const name = entry.fileNameRaw.toString("utf8");
    const slash = name.indexOf("/");
    if (slash <= 0) return null; // un archivo suelto en la raíz
    const first = name.slice(0, slash);
    if (METADATA_DIRS.has(first)) continue;
    if (root === null) root = first;
    else if (root !== first) return null;
  }
  return root;
}

interface EntryEnv {
  rootId: string | null;
  folderIds: Map<string, string | typeof BLOCKED>;
  createFolder: (parent: string | null, name: string) => Promise<string | typeof BLOCKED>;
  summary: ImportSummary;
  skip: (path: string, reason: ImportSkipReason) => void;
  path: string;
}

async function importEntry(
  deps: ZipImportDeps,
  db: TenantDb,
  job: Job,
  zip: Awaited<ReturnType<typeof openZip>>,
  entry: Entry,
  parsed: { dirs: string[]; name: string },
  contentType: string,
  env: EntryEnv,
): Promise<void> {
  // Carpeta de destino.
  let parent = env.rootId;
  let key = "";
  for (const dir of parsed.dirs) {
    key = `${key}/${nameKeyOf(dir)}`;
    let id = env.folderIds.get(key);
    if (id === undefined) {
      id = await env.createFolder(parent, dir);
      env.folderIds.set(key, id);
    }
    if (id === BLOCKED) {
      env.skip(env.path, "nameTaken");
      return;
    }
    parent = id;
  }
  const clash = await db.node.count({
    where: {
      spaceId: job.spaceId,
      parentId: parent,
      nameKey: nameKeyOf(parsed.name),
      trashedAt: null,
    },
  });
  if (clash > 0) {
    env.skip(env.path, "nameTaken");
    return;
  }

  // Reserva de cuota (misma tabla que las subidas: si el worker muere, el job de limpieza la libera).
  const nodeId = randomUUID();
  const storageKey = newStorageKey(db.workspaceId, nodeId, 1);
  const bytes = BigInt(entry.uncompressedSize);
  let reservationId: string;
  try {
    reservationId = await db.$transaction(async (tx) => {
      await lockWorkspace(tx);
      await assertStorageRoom(tx, bytes);
      const row = await tx.uploadReservation.create({
        data: {
          bytes,
          expiresAt: new Date(Date.now() + RESERVATION_TTL_MS),
          createdById: job.createdById,
          spaceId: job.spaceId,
          parentId: parent,
          nodeId,
          isNewNode: true,
          version: 1,
          name: parsed.name,
          conflict: "reject",
          storageKey,
          mimeType: contentType,
        },
        select: { id: true },
      });
      return row.id;
    });
  } catch (error) {
    if (error instanceof AppError && error.code === "LIMIT_REACHED") {
      env.skip(env.path, "overQuota");
      return;
    }
    throw error;
  }

  const release = async (): Promise<void> => {
    await deps.storage.delete(storageKey).catch(() => undefined);
    await db.uploadReservation.deleteMany({ where: { id: reservationId } });
  };

  const scanner = new Scanner();
  try {
    const source: Readable = await zip.openReadStreamPromise(entry);
    // pipeline destruye todo si algo falla (tamaño que miente, ZIP dañado): sin errores sueltos.
    const body = new PassThrough();
    const piped = pipeline(source, scanner, body);
    const uploaded = deps.storage.putStream(storageKey, body, {
      size: entry.uncompressedSize,
      contentType,
    });
    uploaded.catch(() => undefined);
    await piped;
    await uploaded;
  } catch (error) {
    deps.logger.warn({ err: error }, "Entrada de ZIP no descomprimida");
    await release();
    env.skip(env.path, "sizeMismatch");
    return;
  }
  const kind = kindOfFileName(parsed.name);
  const verdict =
    kind === null
      ? { ok: false as const }
      : await inspectContent(kind, Buffer.concat(scanner.head));
  if (scanner.size !== entry.uncompressedSize || !verdict.ok) {
    await release();
    env.skip(
      env.path,
      scanner.size !== entry.uncompressedSize ? "sizeMismatch" : "contentMismatch",
    );
    return;
  }
  const checksum = scanner.hash.digest("hex");

  const outcome = await db.$transaction(async (tx) => {
    await lockWorkspace(tx);
    const taken = await tx.node.count({
      where: {
        spaceId: job.spaceId,
        parentId: parent,
        nameKey: nameKeyOf(parsed.name),
        trashedAt: null,
      },
    });
    if (taken > 0) return "nameTaken" as const;
    const duplicate = await tx.fileVersion.findFirst({
      where: { checksum, purgedAt: null },
      select: { nodeId: true },
    });
    await tx.node.create({
      data: {
        id: nodeId,
        spaceId: job.spaceId,
        parentId: parent,
        type: "FILE",
        name: parsed.name,
        nameKey: nameKeyOf(parsed.name),
        position: await lastPosition({ db: tx }, job.spaceId, parent),
        currentVersion: 1,
        mimeType: contentType,
        sizeBytes: bytes,
        createdById: job.createdById,
        updatedById: job.createdById,
      },
    });
    await tx.fileVersion.create({
      data: {
        nodeId,
        version: 1,
        storageKey,
        fileName: parsed.name,
        mimeType: contentType,
        sizeBytes: bytes,
        checksum,
        uploadedById: job.createdById,
      },
    });
    const workspace = await tx.workspace.findFirstOrThrow({ where: {}, select: { id: true } });
    await tx.workspace.update({
      where: { id: workspace.id },
      data: { storageUsedBytes: { increment: bytes } },
    });
    await tx.uploadReservation.delete({ where: { id: reservationId } });
    return duplicate === null ? ("ok" as const) : ("duplicate" as const);
  });
  if (outcome === "nameTaken") {
    await release();
    env.skip(env.path, "nameTaken");
    return;
  }
  env.summary.imported++;
  env.summary.bytes += entry.uncompressedSize;
  if (outcome === "duplicate") env.summary.duplicates++;
}
