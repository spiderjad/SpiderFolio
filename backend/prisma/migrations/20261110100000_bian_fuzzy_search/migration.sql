-- Búsqueda de Bian tolerante a faltas y acentos: texto normalizado (sin acentos, en minúsculas) para
-- compararlo por trigramas (pg_trgm) con las palabras de la pregunta, además del texto completo.
-- Aditiva. De paso se marcan todos los nodos para reindexar: las tablas pasan a guardarse como texto
-- legible (sin las barras del Markdown).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- unaccent no es IMMUTABLE y una columna generada lo exige: esta envoltura fija el diccionario.
CREATE OR REPLACE FUNCTION spiderfolio_immutable_unaccent(text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS
$$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;

ALTER TABLE "ContentChunk"
  ADD COLUMN "textNorm" text GENERATED ALWAYS AS (lower(spiderfolio_immutable_unaccent("text"))) STORED;

INSERT INTO "ContentChunkDirty" ("nodeId", "workspaceId", "markedAt")
SELECT n."id", n."workspaceId", now() FROM "Node" n
 WHERE n."type"::text <> 'FOLDER' AND n."trashedAt" IS NULL
ON CONFLICT ("nodeId") DO NOTHING;
