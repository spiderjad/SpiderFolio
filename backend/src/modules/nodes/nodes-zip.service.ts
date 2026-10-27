// Descarga de una selección como ZIP: carpetas completas y archivos sueltos de un espacio. Solo
// entra lo que la persona puede ver (resolveAccess); el resto se omite sin avisar que existe.
import type { Readable } from "node:stream";
import { bytesToJson } from "@spiderfolio/limits";
import { AppError, notFound } from "../../lib/errors.ts";
import type { Storage } from "../../lib/storage.ts";
import { accessFor, levelOfSpace, requireLevel } from "../access/access-context.ts";
import type { AdminContext } from "../admin/admin-context.ts";
import { MAX_TREE_DEPTH } from "./nodes.service.ts";
import { ZIP_MAX_BYTES, ZIP_MAX_ENTRIES, type ZipEntry } from "./zip-writer.ts";
import { fileMessages } from "../../i18n/index.ts";

interface Collected {
  id: string;
  parentId: string | null;
  type: "FOLDER" | "FILE" | "PAGE";
  name: string;
  updatedAt: Date;
}

const collectedSelect = {
  id: true,
  parentId: true,
  type: true,
  name: true,
  updatedAt: true,
} as const;

export interface ZipPlan {
  fileName: string;
  entries: ZipEntry[];
  /** Suma de los archivos (sin encabezados). */
  totalBytes: number;
}

function tooBig(): AppError {
  return new AppError("PAYLOAD_TOO_LARGE", {
    message: fileMessages.zipTooBig,
  });
}

/** Arma las entradas del ZIP. Falla con 413 si la selección es demasiado grande. */
export async function planZipDownload(
  ctx: AdminContext,
  storage: Pick<Storage, "stream">,
  spaceId: string,
  nodeIds: readonly string[],
): Promise<ZipPlan> {
  requireLevel(await levelOfSpace(ctx, spaceId), "VIEW");
  const space = await ctx.db.space.findFirst({ where: { id: spaceId }, select: { name: true } });
  if (space === null) throw notFound();
  const roots = await ctx.db.node.findMany({
    where: { id: { in: [...nodeIds] }, spaceId, trashedAt: null },
    select: collectedSelect,
  });
  if (roots.length === 0) throw notFound();

  const all = new Map<string, Collected>(roots.map((row) => [row.id, row]));
  let frontier = roots.filter((row) => row.type === "FOLDER").map((row) => row.id);
  for (let depth = 0; frontier.length > 0 && depth <= MAX_TREE_DEPTH; depth += 1) {
    const children = await ctx.db.node.findMany({
      where: { spaceId, parentId: { in: frontier }, trashedAt: null },
      select: collectedSelect,
      take: ZIP_MAX_ENTRIES + 1,
    });
    for (const child of children) all.set(child.id, child);
    if (all.size > ZIP_MAX_ENTRIES) throw tooBig();
    frontier = children.filter((row) => row.type === "FOLDER").map((row) => row.id);
  }

  const access = await accessFor(ctx, { nodeIds: [...all.keys()], spaceIds: [spaceId] });
  const visible = new Map([...all].filter(([id]) => access.ofNode(id) !== null));
  const rootIds = new Set(roots.map((row) => row.id));
  const pathOf = (node: Collected): string => {
    const parts = [node.name];
    let parent =
      rootIds.has(node.id) || node.parentId === null ? undefined : visible.get(node.parentId);
    while (parent !== undefined) {
      parts.unshift(parent.name);
      parent =
        rootIds.has(parent.id) || parent.parentId === null
          ? undefined
          : visible.get(parent.parentId);
    }
    return parts.join("/");
  };

  const fileIds = [...visible.values()].filter((row) => row.type === "FILE").map((row) => row.id);
  const [nodes, versions] = await Promise.all([
    ctx.db.node.findMany({
      where: { id: { in: fileIds } },
      select: { id: true, currentVersion: true },
    }),
    ctx.db.fileVersion.findMany({
      where: { nodeId: { in: fileIds }, purgedAt: null },
      select: { nodeId: true, version: true, storageKey: true, sizeBytes: true },
    }),
  ]);
  const current = new Map(nodes.map((row) => [row.id, row.currentVersion]));
  const versionOf = new Map(
    versions
      .filter((row) => current.get(row.nodeId) === row.version)
      .map((row) => [row.nodeId, row]),
  );

  const withContent = new Set<string>();
  for (const node of visible.values()) {
    if (node.parentId !== null) withContent.add(node.parentId);
  }
  const entries: ZipEntry[] = [];
  let total = 0;
  for (const node of [...visible.values()].sort((a, b) => pathOf(a).localeCompare(pathOf(b)))) {
    if (node.type === "FOLDER") {
      // Las carpetas vacías también viajan, para conservar la estructura.
      if (!withContent.has(node.id)) {
        entries.push({
          path: `${pathOf(node)}/`,
          size: 0,
          modified: node.updatedAt,
          open: () => Promise.reject(new Error("Una carpeta no tiene contenido")),
        });
      }
      continue;
    }
    if (node.type !== "FILE") continue;
    const version = versionOf.get(node.id);
    if (version === undefined) continue;
    const size = bytesToJson(version.sizeBytes);
    total += size;
    if (total > ZIP_MAX_BYTES) throw tooBig();
    entries.push({
      path: pathOf(node),
      size,
      modified: node.updatedAt,
      open: (): Promise<Readable> => storage.stream(version.storageKey),
    });
  }
  if (entries.length === 0) {
    throw new AppError("BAD_REQUEST", { message: fileMessages.zipNothing });
  }
  const only = roots.length === 1 ? roots[0] : undefined;
  return {
    fileName: `${only?.type === "FOLDER" ? only.name : space.name}.zip`,
    entries,
    totalBytes: total,
  };
}
