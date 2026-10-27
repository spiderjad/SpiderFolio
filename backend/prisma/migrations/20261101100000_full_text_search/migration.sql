-- Búsqueda de texto completo (español sin acentos). Aditiva: columnas nuevas, una tabla, funciones y
-- triggers que mantienen el índice al día sin tocar el código de cada módulo.

CREATE EXTENSION IF NOT EXISTS unaccent;

-- Configuración «es_unaccent»: la del español, pero quitando los acentos antes de reducir a la raíz.
-- Sirve igual para indexar, para buscar y para resaltar el fragmento (ts_headline).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_ts_config WHERE cfgname = 'es_unaccent') THEN
    CREATE TEXT SEARCH CONFIGURATION es_unaccent (COPY = spanish);
    ALTER TEXT SEARCH CONFIGURATION es_unaccent
      ALTER MAPPING FOR hword, hword_part, word WITH unaccent, spanish_stem;
  END IF;
END
$$;

-- AlterTable
ALTER TABLE "Node" ADD COLUMN "searchText" TEXT NOT NULL DEFAULT '',
ADD COLUMN "searchTsv" tsvector;

-- AlterTable
ALTER TABLE "DocumentVersion" ADD COLUMN "textPlain" TEXT;

-- CreateTable
CREATE TABLE "FileText" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OK',
    "extractedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FileText_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Node_searchTsv_idx" ON "Node" USING GIN ("searchTsv");

-- CreateIndex
CREATE UNIQUE INDEX "FileText_nodeId_version_key" ON "FileText"("nodeId", "version");

-- CreateIndex
CREATE INDEX "FileText_workspaceId_nodeId_idx" ON "FileText"("workspaceId", "nodeId");

-- AddForeignKey
ALTER TABLE "FileText" ADD CONSTRAINT "FileText_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileText" ADD CONSTRAINT "FileText_nodeId_workspaceId_fkey" FOREIGN KEY ("nodeId", "workspaceId") REFERENCES "Node"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- Arma el texto y el índice de un nodo: título y código (peso A) y cuerpo (peso B).
--   · Página: el texto de la versión vigente si es un documento controlado publicado (quien no edita
--     lee esa, no el borrador); si no, el texto actual.
--   · Archivo: el texto extraído de la versión vigente (o la actual si no es controlado).
-- Si el texto es tan grande que no entra en un tsvector, queda indexado solo por el título.
CREATE OR REPLACE FUNCTION spiderfolio_refresh_node_search(p_node text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_title text;
  v_type text;
  v_current integer;
  v_code text;
  v_body text := '';
  v_words text;
  v_published boolean := false;
  v_published_text text;
  v_published_file integer;
BEGIN
  SELECT n."name", n."type"::text, n."currentVersion"
    INTO v_title, v_type, v_current
    FROM "Node" n WHERE n."id" = p_node;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  SELECT cd."code" INTO v_code FROM "ControlledDocument" cd WHERE cd."nodeId" = p_node;
  SELECT true, dv."textPlain", dv."fileVersion"
    INTO v_published, v_published_text, v_published_file
    FROM "DocumentVersion" dv
    WHERE dv."nodeId" = p_node AND dv."status" = 'PUBLISHED';
  v_published := coalesce(v_published, false);

  IF v_type = 'PAGE' THEN
    IF v_published THEN
      v_body := coalesce(v_published_text, '');
    ELSE
      SELECT coalesce(pc."textPlain", '') INTO v_body FROM "PageContent" pc WHERE pc."nodeId" = p_node;
    END IF;
  ELSIF v_type = 'FILE' THEN
    SELECT coalesce(ft."text", '') INTO v_body
      FROM "FileText" ft
      WHERE ft."nodeId" = p_node AND ft."version" = coalesce(v_published_file, v_current);
  END IF;
  v_body := left(coalesce(v_body, ''), 300000);
  -- El nombre de un archivo trae punto y guiones bajos: se separan para que «Certificado» encuentre
  -- «Certificado.pdf».
  v_words := regexp_replace(v_title, '[._/]+', ' ', 'g') || ' ' || coalesce(v_code, '');

  BEGIN
    UPDATE "Node" SET
      "searchText" = v_body,
      "searchTsv" =
        setweight(to_tsvector('es_unaccent', v_words), 'A') ||
        setweight(to_tsvector('es_unaccent', v_body), 'B')
    WHERE "id" = p_node;
  EXCEPTION WHEN OTHERS THEN
    UPDATE "Node" SET
      "searchText" = '',
      "searchTsv" = setweight(to_tsvector('es_unaccent', v_words), 'A')
    WHERE "id" = p_node;
  END;
END
$$;

CREATE OR REPLACE FUNCTION spiderfolio_search_trigger() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_node text;
BEGIN
  IF TG_TABLE_NAME = 'Node' THEN
    v_node := NEW."id";
  ELSIF TG_OP = 'DELETE' THEN
    v_node := OLD."nodeId";
  ELSE
    v_node := NEW."nodeId";
  END IF;
  PERFORM spiderfolio_refresh_node_search(v_node);
  RETURN NULL;
END
$$;

CREATE TRIGGER "Node_search_refresh"
  AFTER INSERT OR UPDATE OF "name", "currentVersion" ON "Node"
  FOR EACH ROW EXECUTE FUNCTION spiderfolio_search_trigger();

CREATE TRIGGER "PageContent_search_refresh"
  AFTER INSERT OR UPDATE OF "textPlain" ON "PageContent"
  FOR EACH ROW EXECUTE FUNCTION spiderfolio_search_trigger();

CREATE TRIGGER "FileText_search_refresh"
  AFTER INSERT OR UPDATE OF "text" OR DELETE ON "FileText"
  FOR EACH ROW EXECUTE FUNCTION spiderfolio_search_trigger();

CREATE TRIGGER "DocumentVersion_search_refresh"
  AFTER INSERT OR UPDATE OF "status", "textPlain", "fileVersion" ON "DocumentVersion"
  FOR EACH ROW EXECUTE FUNCTION spiderfolio_search_trigger();

CREATE TRIGGER "ControlledDocument_search_refresh"
  AFTER INSERT ON "ControlledDocument"
  FOR EACH ROW EXECUTE FUNCTION spiderfolio_search_trigger();

-- Lo que ya existe se indexa ahora.
SELECT spiderfolio_refresh_node_search("id") FROM "Node";
