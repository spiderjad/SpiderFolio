// Cola de reindexado de Bian (SQL a mano: tarea de mantenimiento entre workspaces). Cada fila lleva su
// workspaceId; quien procesa abre después el cliente del tenant de esa fila.
import { Prisma } from "../../generated/prisma/client.ts";
import type { PrismaClient } from "../../lib/prisma.ts";

export interface DirtyNode {
  nodeId: string;
  workspaceId: string;
}

/**
 * Toma y saca de la cola hasta `limit` nodos (los más viejos primero). Varios workers no se pisan:
 * `FOR UPDATE SKIP LOCKED`. Si el procesamiento falla, quien llama los vuelve a marcar.
 */
export async function claimDirtyNodes(prisma: PrismaClient, limit: number): Promise<DirtyNode[]> {
  return prisma.$queryRaw<DirtyNode[]>`
    DELETE FROM "ContentChunkDirty"
     WHERE "nodeId" IN (
       SELECT "nodeId" FROM "ContentChunkDirty"
        ORDER BY "markedAt"
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED)
    RETURNING "nodeId", "workspaceId"`;
}

export async function markNodeDirty(prisma: PrismaClient, node: DirtyNode): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO "ContentChunkDirty" ("nodeId", "workspaceId", "markedAt")
    VALUES (${node.nodeId}, ${node.workspaceId}, now())
    ON CONFLICT ("nodeId") DO NOTHING`;
}

/** Marca todas las páginas y archivos fuera de la papelera (primer encendido de Bian). */
export async function markAllNodesDirty(prisma: PrismaClient): Promise<number> {
  return prisma.$executeRaw`
    INSERT INTO "ContentChunkDirty" ("nodeId", "workspaceId", "markedAt")
    SELECT n."id", n."workspaceId", now() FROM "Node" n
     WHERE n."type"::text <> 'FOLDER' AND n."trashedAt" IS NULL
    ON CONFLICT ("nodeId") DO NOTHING`;
}

export interface ChunkCandidate {
  id: string;
  nodeId: string;
  rank: number;
  /** El fragmento contiene todas las palabras de la pregunta (no solo algunas). */
  strict: boolean;
}

/**
 * Fragmentos que responden a la pregunta, con el permiso en la consulta (los espacios que la persona
 * ve y lo compartido con ella, con lo que cuelga de eso). Combina el texto completo (con raíces de
 * palabras) y la similitud por trigramas con las `words` de la pregunta ya normalizadas (sin acentos,
 * en minúsculas): así una falta de ortografía como «alerjenos» igual encuentra «alérgenos». Primero
 * los que tienen todas las palabras; después, por relevancia. Cada candidato se confirma luego con el
 * motor de acceso. Toda consulta lleva el workspaceId del contexto, nunca del texto.
 */
export async function searchChunks(
  prisma: PrismaClient,
  params: {
    workspaceId: string;
    query: string;
    /** Palabras de la pregunta para la búsqueda por trigramas (ver query-terms.ts). */
    words: readonly string[];
    visibleSpaceIds: readonly string[];
    grantedNodeIds: readonly string[];
    offset: number;
    limit: number;
  },
): Promise<ChunkCandidate[]> {
  const { workspaceId, query } = params;
  return prisma.$queryRaw<ChunkCandidate[]>(Prisma.sql`
    WITH RECURSIVE granted(id) AS (
      SELECT g."id" FROM "Node" g
       WHERE g."workspaceId" = ${workspaceId}
         AND g."trashedAt" IS NULL
         AND g."id" = ANY(${[...params.grantedNodeIds]}::text[])
      UNION
      SELECT c."id" FROM "Node" c JOIN granted p ON c."parentId" = p."id"
       WHERE c."workspaceId" = ${workspaceId} AND c."trashedAt" IS NULL
    ),
    q AS (
      SELECT plainto_tsquery('es_unaccent', ${query}) AS strict_q,
             replace(plainto_tsquery('es_unaccent', ${query})::text, '&', '|')::tsquery AS loose_q
    ),
    w AS (
      -- Cuanto más corta la palabra, más parecido se exige (si no, todo se parece a todo).
      SELECT x AS word,
             CASE WHEN length(x) >= 8 THEN 0.5 WHEN length(x) >= 6 THEN 0.6 ELSE 0.75 END AS threshold
        FROM unnest(${[...params.words]}::text[]) AS x
    )
    SELECT s."id", s."nodeId", s."rank", s."strict" FROM (
    SELECT c."id", c."nodeId",
           ts_rank_cd(c."tsv", q.loose_q, 32)::float8 AS "rank",
           COALESCE((SELECT max(word_similarity(w.word, c."textNorm")) FROM w), 0)::float8 AS "sim",
           (c."tsv" @@ q.strict_q) AS "strict"
      FROM "ContentChunk" c
      JOIN "Node" n ON n."id" = c."nodeId" AND n."workspaceId" = c."workspaceId", q
     WHERE c."workspaceId" = ${workspaceId}
       AND n."trashedAt" IS NULL
       AND (
         c."tsv" @@ q.loose_q
         OR EXISTS (SELECT 1 FROM w WHERE word_similarity(w.word, c."textNorm") >= w.threshold)
       )
       AND (n."spaceId" = ANY(${[...params.visibleSpaceIds]}::text[]) OR n."id" IN (SELECT id FROM granted))
    ) s
     ORDER BY s."strict" DESC, (s."rank" + s."sim") DESC, s."id" ASC
     OFFSET ${params.offset} LIMIT ${params.limit}
  `);
}

/**
 * Suma una consulta al contador del período solo si queda cupo (atómico: dos pedidos a la vez no
 * pasan el límite). Devuelve el nuevo total, o null si ya se llegó al máximo. `max` null = sin límite.
 */
export async function reserveUsage(
  prisma: PrismaClient,
  params: { workspaceId: string; periodStart: Date; max: number | null },
): Promise<number | null> {
  if (params.max !== null && params.max <= 0) return null;
  const rows = await prisma.$queryRaw<{ aiQueries: number }[]>(Prisma.sql`
    INSERT INTO "UsageCounter" ("workspaceId", "periodStart", "aiQueries")
    VALUES (${params.workspaceId}, ${params.periodStart}, 1)
    ON CONFLICT ("workspaceId", "periodStart")
    DO UPDATE SET "aiQueries" = "UsageCounter"."aiQueries" + 1
    WHERE ${params.max}::int IS NULL OR "UsageCounter"."aiQueries" < ${params.max}::int
    RETURNING "aiQueries"`);
  return rows[0]?.aiQueries ?? null;
}

/** Devuelve una consulta reservada que al final no se usó (falló, se rechazó o no había evidencia). */
export async function refundUsage(
  prisma: PrismaClient,
  params: { workspaceId: string; periodStart: Date },
): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "UsageCounter" SET "aiQueries" = GREATEST("aiQueries" - 1, 0)
     WHERE "workspaceId" = ${params.workspaceId} AND "periodStart" = ${params.periodStart}`;
}
