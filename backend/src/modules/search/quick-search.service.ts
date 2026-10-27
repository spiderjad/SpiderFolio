// Búsqueda rápida de la paleta Ctrl+K: por título y por código de documento controlado, agrupada en
// documentos, carpetas, espacios y personas. Solo devuelve lo que la persona ve: cada candidato se
// confirma con el motor de acceso antes de salir, y el servidor corta en pocos resultados por grupo.
import type { NodeType, Prisma } from "../../generated/prisma/client.ts";
import { nameKeyOf } from "../../lib/names.ts";
import { atLeast } from "../access/access.ts";
import { accessFor } from "../access/access-context.ts";
import type { AdminContext } from "../admin/admin-context.ts";
import { DirectoryQuerySchema } from "../directory/directory.schemas.ts";
import { listDirectory } from "../directory/directory.service.ts";
import { visibleSpacesWhere } from "../spaces/spaces.service.ts";
import type { QuickQuery } from "./search.schemas.ts";

const PER_GROUP = 6;
const BATCH = 40;
const MAX_BATCHES = 5;

export interface QuickNodeHit {
  id: string;
  name: string;
  type: NodeType;
  icon: string | null;
  spaceId: string;
  spaceName: string;
  parentId: string | null;
  /** Código del documento controlado (PRC-001), si lo tiene. */
  code: string | null;
}

export interface QuickSpaceHit {
  id: string;
  name: string;
  icon: string | null;
}

export interface QuickPersonHit {
  id: string;
  name: string;
  jobTitle: string | null;
  departments: string[];
}

export interface QuickResults {
  documents: QuickNodeHit[];
  folders: QuickNodeHit[];
  spaces: QuickSpaceHit[];
  people: QuickPersonHit[];
}

const nodeSelect = {
  id: true,
  name: true,
  type: true,
  icon: true,
  spaceId: true,
  parentId: true,
  space: { select: { name: true } },
  controlled: { select: { code: true } },
} as const;

export async function quickSearch(ctx: AdminContext, query: QuickQuery): Promise<QuickResults> {
  const q = query.q;
  const now = new Date();
  if (query.spaces === "writable") {
    // «Nueva página»: los espacios donde puede crear, sin hacer falta escribir.
    const rows = await ctx.db.space.findMany({
      where: {
        AND: [
          visibleSpacesWhere(ctx, now),
          { archivedAt: null },
          { nameKey: { contains: nameKeyOf(q) } },
        ],
      },
      select: { id: true, name: true, icon: true },
      orderBy: [{ nameKey: "asc" }, { id: "asc" }],
      take: 40,
    });
    const access = await accessFor(ctx, { spaceIds: rows.map((row) => row.id) });
    return {
      documents: [],
      folders: [],
      people: [],
      spaces: rows.filter((row) => atLeast(access.ofSpace(row.id), "EDIT")).slice(0, 12),
    };
  }
  if (q.length === 0) return { documents: [], folders: [], spaces: [], people: [] };
  const text = { contains: q, mode: "insensitive" as const };
  const where: Prisma.NodeWhereInput = {
    trashedAt: null,
    OR: [{ nameKey: { contains: nameKeyOf(q) } }, { controlled: { code: text } }],
  };
  const documents: QuickNodeHit[] = [];
  const folders: QuickNodeHit[] = [];
  const lower = nameKeyOf(q);
  for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
    if (documents.length >= PER_GROUP && folders.length >= PER_GROUP) break;
    const rows = await ctx.db.node.findMany({
      where,
      select: nodeSelect,
      // Los que empiezan igual primero (el orden por nombre los deja juntos).
      orderBy: [{ nameKey: "asc" }, { id: "asc" }],
      skip: batch * BATCH,
      take: BATCH,
    });
    if (rows.length === 0) break;
    const access = await accessFor(ctx, { nodeIds: rows.map((row) => row.id) });
    for (const row of rows) {
      if (!atLeast(access.ofNode(row.id), "VIEW")) continue;
      const hit: QuickNodeHit = {
        id: row.id,
        name: row.name,
        type: row.type,
        icon: row.icon,
        spaceId: row.spaceId,
        spaceName: row.space.name,
        parentId: row.parentId,
        code: row.controlled?.code ?? null,
      };
      const list = row.type === "FOLDER" ? folders : documents;
      if (list.length < PER_GROUP) list.push(hit);
    }
    if (rows.length < BATCH) break;
  }
  // Primero lo que empieza con lo escrito.
  const starts = (hit: QuickNodeHit) =>
    nameKeyOf(hit.name).startsWith(lower) || (hit.code ?? "").toLowerCase().startsWith(lower);
  for (const list of [documents, folders])
    list.sort((a, b) => Number(starts(b)) - Number(starts(a)));

  const spaceRows = await ctx.db.space.findMany({
    where: {
      AND: [visibleSpacesWhere(ctx, now), { archivedAt: null }, { nameKey: { contains: lower } }],
    },
    select: { id: true, name: true, icon: true },
    orderBy: [{ nameKey: "asc" }, { id: "asc" }],
    take: PER_GROUP * 2,
  });
  const spaceAccess = await accessFor(ctx, { spaceIds: spaceRows.map((row) => row.id) });
  const spaces = spaceRows
    .filter((row) => atLeast(spaceAccess.ofSpace(row.id), "VIEW"))
    .slice(0, PER_GROUP);

  // Las personas, con las mismas reglas del directorio (quién ve a quién).
  const directory = await listDirectory(
    ctx,
    DirectoryQuerySchema.parse({ q, pageSize: String(PER_GROUP) }),
  );
  return {
    documents,
    folders,
    spaces,
    people: directory.items.map((person) => ({
      id: person.id,
      name: person.name,
      jobTitle: person.jobTitle,
      departments: person.departments.map((d) => d.name),
    })),
  };
}
