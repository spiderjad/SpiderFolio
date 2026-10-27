// Importación (docs/spec/adopcion.md, 9C.2): arrastrar una carpeta completa o subir un ZIP conserva
// la estructura. Carpetas: el navegador manda la estructura y los tamaños (el plan); el servidor
// valida cuota, tipos y nombres, crea las carpetas en una transacción y devuelve a qué carpeta va
// cada archivo (que entra por la cola de subidas, reanudable). ZIP: se sube como cualquier archivo y
// el worker lo descomprime en el destino (zip-import.ts), con protección contra bombas.
import { limitInBaseUnits } from "@spiderfolio/limits";
import { AppError, notFound } from "../../lib/errors.ts";
import { kindOfFileName } from "../../lib/file-types.ts";
import { nameKeyOf } from "../../lib/names.ts";
import { fileMessages } from "../../i18n/index.ts";
import { accessFor, levelOfNode, requireLevel } from "../access/access-context.ts";
import { atLeast } from "../access/access.ts";
import { auditAdmin, type AdminContext } from "../admin/admin-context.ts";
import { workspaceLimits } from "../limits/limits.service.ts";
import { assertStorageRoom } from "../files/files.service.ts";
import { assertDestination, lastPosition, MAX_TREE_DEPTH } from "../nodes/nodes.service.ts";
import type { Jobs } from "../../jobs/boss.ts";
import {
  BLOCKED,
  MAX_IMPORT_ENTRIES,
  parseImportPath,
  type ImportSkipReason,
} from "./import-paths.ts";
import type { ImportPlanInput, StartZipImportInput } from "./imports.schemas.ts";

export interface ImportPlanResult {
  folders: { created: number; reused: number };
  /** Los archivos que se pueden subir, con la carpeta de destino ya creada. */
  accepted: { path: string; parentId: string | null; name: string; size: number }[];
  skipped: { path: string; reason: ImportSkipReason }[];
  totalBytes: number;
}

interface Candidate {
  path: string;
  dirs: string[];
  name: string;
  size: number;
}

export async function planImport(
  ctx: AdminContext,
  spaceId: string,
  input: ImportPlanInput,
): Promise<ImportPlanResult> {
  const parentId = input.parentId ?? null;
  const { depth } = await assertDestination(ctx, spaceId, parentId);
  const maxFile = limitInBaseUnits("maxFileMb", (await workspaceLimits(ctx.db)).maxFileMb);

  const skipped: ImportPlanResult["skipped"] = [];
  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  for (const entry of input.entries) {
    const parsed = parseImportPath(entry.path, MAX_TREE_DEPTH - depth);
    if (!parsed.ok) {
      skipped.push({ path: entry.path, reason: parsed.reason });
      continue;
    }
    if (kindOfFileName(parsed.name) === null) {
      skipped.push({ path: entry.path, reason: "unsupportedType" });
    } else if (entry.size === 0) {
      skipped.push({ path: entry.path, reason: "empty" });
    } else if (maxFile !== null && BigInt(entry.size) > maxFile) {
      skipped.push({ path: entry.path, reason: "tooLarge" });
    } else {
      // Dos rutas que dan el mismo nombre en la misma carpeta (sin mayúsculas): la segunda se omite.
      const key = [...parsed.dirs, parsed.name].map(nameKeyOf).join("/");
      if (seen.has(key)) {
        skipped.push({ path: entry.path, reason: "nameTaken" });
      } else {
        seen.add(key);
        candidates.push({ path: entry.path, ...parsed, size: entry.size });
      }
    }
  }

  // La cuota se mira antes de crear nada: si no entra todo, se avisa (LIMIT_REACHED).
  const totalBytes = candidates.reduce((sum, item) => sum + BigInt(item.size), 0n);
  if (candidates.length > 0) await assertStorageRoom(ctx.db, totalBytes);

  // Carpetas: una por cada ruta de carpetas distinta, de las más altas a las más profundas.
  const dirPaths = new Map<string, string[]>();
  for (const item of candidates) {
    for (let level = 1; level <= item.dirs.length; level++) {
      const dirs = item.dirs.slice(0, level);
      dirPaths.set(dirs.map(nameKeyOf).join("/"), dirs);
    }
  }
  const ordered = [...dirPaths.entries()].sort((a, b) => a[1].length - b[1].length);
  const folderIds = new Map<string, string | typeof BLOCKED>();
  const reusedIds: string[] = [];
  let created = 0;
  await ctx.db.$transaction(async (tx) => {
    for (const [key, dirs] of ordered) {
      const name = dirs.at(-1) ?? "";
      const parentKey = dirs.slice(0, -1).map(nameKeyOf).join("/");
      const parent = dirs.length === 1 ? parentId : (folderIds.get(parentKey) ?? BLOCKED);
      if (parent === BLOCKED) {
        folderIds.set(key, BLOCKED);
        continue;
      }
      const existing = await tx.node.findFirst({
        where: { spaceId, parentId: parent, nameKey: nameKeyOf(name), trashedAt: null },
        select: { id: true, type: true },
      });
      if (existing !== null) {
        if (existing.type === "FOLDER") {
          folderIds.set(key, existing.id);
          reusedIds.push(existing.id);
        } else {
          // Hay un archivo con el nombre de la carpeta: no se puede entrar ahí.
          folderIds.set(key, BLOCKED);
        }
        continue;
      }
      const folder = await tx.node.create({
        data: {
          spaceId,
          parentId: parent,
          type: "FOLDER",
          name,
          nameKey: nameKeyOf(name),
          position: await lastPosition({ db: tx }, spaceId, parent),
          createdById: ctx.tenant.membershipId,
          updatedById: ctx.tenant.membershipId,
        },
        select: { id: true },
      });
      folderIds.set(key, folder.id);
      created++;
    }
    await auditAdmin(
      { db: tx, info: ctx.info },
      {
        action: "import.folder",
        entityType: "Space",
        entityId: spaceId,
        metadata: { entries: input.entries.length, files: candidates.length, folders: created },
      },
    );
  });

  // En las carpetas que ya existían hace falta poder editar (pueden cortar la herencia).
  const access = reusedIds.length === 0 ? null : await accessFor(ctx, { nodeIds: reusedIds });
  const editable = (id: string): boolean => access === null || atLeast(access.ofNode(id), "EDIT");

  const accepted: ImportPlanResult["accepted"] = [];
  for (const item of candidates) {
    const key = item.dirs.map(nameKeyOf).join("/");
    const folder = item.dirs.length === 0 ? parentId : (folderIds.get(key) ?? BLOCKED);
    if (folder === BLOCKED) {
      skipped.push({ path: item.path, reason: "nameTaken" });
    } else if (folder !== null && !editable(folder)) {
      skipped.push({ path: item.path, reason: "noPermission" });
    } else {
      accepted.push({ path: item.path, parentId: folder, name: item.name, size: item.size });
    }
  }
  return {
    folders: { created, reused: reusedIds.length },
    accepted,
    skipped,
    totalBytes: Number(totalBytes),
  };
}

// ─── ZIP ─────────────────────────────────────────────────────────────────────────────────

export interface ImportView {
  id: string;
  status: "PENDING" | "RUNNING" | "DONE" | "FAILED";
  createdAt: Date;
  finishedAt: Date | null;
  summary: unknown;
  error: string | null;
}

const importSelect = {
  id: true,
  status: true,
  createdAt: true,
  finishedAt: true,
  summary: true,
  error: true,
} as const;

function toImportView(row: {
  id: string;
  status: string;
  createdAt: Date;
  finishedAt: Date | null;
  summary: unknown;
  error: string | null;
}): ImportView {
  const status = ["PENDING", "RUNNING", "DONE", "FAILED"].includes(row.status)
    ? (row.status as ImportView["status"])
    : "FAILED";
  return { ...row, status };
}

/** Pide descomprimir un ZIP que ya está en el árbol: encola el trabajo del worker. */
export async function startZipImport(
  ctx: AdminContext,
  jobs: Jobs,
  fileId: string,
  input: StartZipImportInput,
): Promise<ImportView> {
  const node = await ctx.db.node.findFirst({
    where: { id: fileId, trashedAt: null },
    select: { id: true, type: true, name: true, spaceId: true, parentId: true, mimeType: true },
  });
  if (node === null) throw notFound();
  requireLevel(await levelOfNode(ctx, fileId), "VIEW");
  if (node.type !== "FILE" || node.mimeType !== "application/zip") {
    throw new AppError("BAD_REQUEST", { message: fileMessages.notAZip });
  }
  // Quien importa tiene que poder escribir en el destino (la carpeta del ZIP).
  await assertDestination(ctx, node.spaceId, node.parentId);
  const row = await ctx.db.$transaction(async (tx) => {
    const created = await tx.importJob.create({
      data: {
        spaceId: node.spaceId,
        parentId: node.parentId,
        nodeId: node.id,
        createdById: ctx.tenant.membershipId,
        newFolder: input.newFolder,
        status: "PENDING",
      },
      select: importSelect,
    });
    await jobs.enqueue("zip-import", { importId: created.id }, { tx });
    await auditAdmin(
      { db: tx, info: ctx.info },
      {
        action: "import.zip.start",
        entityType: "Node",
        entityId: node.id,
        metadata: { importId: created.id, newFolder: input.newFolder },
      },
    );
    return created;
  });
  return toImportView(row);
}

/** El estado de una importación: solo de quien la pidió. */
export async function getImport(ctx: AdminContext, id: string): Promise<ImportView> {
  const row = await ctx.db.importJob.findFirst({
    where: { id, createdById: ctx.tenant.membershipId },
    select: importSelect,
  });
  if (row === null) throw notFound();
  return toImportView(row);
}

export { MAX_IMPORT_ENTRIES };
