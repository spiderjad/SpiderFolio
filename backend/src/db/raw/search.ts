// Consultas de texto completo (Postgres, configuración es_unaccent). SQL a mano porque Prisma no
// conoce tsvector. Toda consulta lleva el workspaceId: lo decide quien llama (el contexto de la
// persona), nunca el texto buscado. El permiso se aplica ACÁ, en la consulta (solo los espacios que
// la persona ve y lo compartido con ella y lo que cuelga de eso); después se confirma uno a uno
// con el motor de acceso, que ya es un conjunto chico.
import { Prisma } from "../../generated/prisma/client.ts";
import type { PrismaClient } from "../../lib/prisma.ts";

/** Marcas de la palabra encontrada: caracteres privados que no aparecen en un texto normal. */
export const MARK_START = "";
export const MARK_END = "";

export interface Candidate {
  id: string;
  rank: number;
}

export async function searchCandidates(
  prisma: PrismaClient,
  params: {
    workspaceId: string;
    query: string;
    visibleSpaceIds: readonly string[];
    grantedNodeIds: readonly string[];
    offset: number;
    limit: number;
  },
): Promise<Candidate[]> {
  const { workspaceId, query } = params;
  const rows = await prisma.$queryRaw<{ id: string; rank: number }[]>(Prisma.sql`
    WITH RECURSIVE granted(id) AS (
      SELECT g."id" FROM "Node" g
       WHERE g."workspaceId" = ${workspaceId}
         AND g."trashedAt" IS NULL
         AND g."id" = ANY(${[...params.grantedNodeIds]}::text[])
      UNION
      SELECT c."id" FROM "Node" c JOIN granted p ON c."parentId" = p."id"
       WHERE c."workspaceId" = ${workspaceId} AND c."trashedAt" IS NULL
    )
    SELECT n."id", ts_rank_cd(n."searchTsv", q.query, 32)::float8 AS rank
      FROM "Node" n, websearch_to_tsquery('es_unaccent', ${query}) AS q(query)
     WHERE n."workspaceId" = ${workspaceId}
       AND n."trashedAt" IS NULL
       AND n."searchTsv" @@ q.query
       AND (n."spaceId" = ANY(${[...params.visibleSpaceIds]}::text[]) OR n."id" IN (SELECT id FROM granted))
     ORDER BY rank DESC, n."id" ASC
     OFFSET ${params.offset} LIMIT ${params.limit}
  `);
  return rows.map((row) => ({ id: row.id, rank: row.rank }));
}

export interface Highlight {
  title: string;
  snippet: string;
}

/** Título y fragmento con la palabra marcada, solo de los nodos que ya se decidió mostrar. */
export async function highlightNodes(
  prisma: PrismaClient,
  workspaceId: string,
  ids: readonly string[],
  query: string,
): Promise<Map<string, Highlight>> {
  if (ids.length === 0) return new Map();
  const options = `StartSel=${MARK_START}, StopSel=${MARK_END}, MaxFragments=1, MaxWords=26, MinWords=10, ShortWord=2`;
  const rows = await prisma.$queryRaw<{ id: string; title: string; snippet: string }[]>(Prisma.sql`
    SELECT n."id",
           ts_headline('es_unaccent', n."name", q.query,
             ${`StartSel=${MARK_START}, StopSel=${MARK_END}, HighlightAll=true`}) AS title,
           ts_headline('es_unaccent', n."searchText", q.query, ${options}) AS snippet
      FROM "Node" n, websearch_to_tsquery('es_unaccent', ${query}) AS q(query)
     WHERE n."workspaceId" = ${workspaceId} AND n."id" = ANY(${[...ids]}::text[])
  `);
  return new Map(rows.map((row) => [row.id, { title: row.title, snippet: row.snippet }]));
}

/** Rehace el índice de un nodo (la función de la base arma título, código y cuerpo). */
export async function refreshNodeSearch(prisma: PrismaClient, nodeId: string): Promise<void> {
  await prisma.$executeRaw`SELECT spiderfolio_refresh_node_search(${nodeId})`;
}

/** Nodos sin índice, de a tandas (cualquier workspace: es una tarea de mantenimiento). */
export async function nodesWithoutIndex(prisma: PrismaClient, limit: number): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "Node" WHERE "searchTsv" IS NULL LIMIT ${limit}`;
  return rows.map((row) => row.id);
}

/** Ids de nodos en orden, a partir de uno (para recorrerlos todos). */
export async function nodeIdsAfter(
  prisma: PrismaClient,
  after: string,
  limit: number,
): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "Node" WHERE "id" > ${after} ORDER BY "id" LIMIT ${limit}`;
  return rows.map((row) => row.id);
}
