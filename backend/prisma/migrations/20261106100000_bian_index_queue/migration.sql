-- Cola de nodos a reindexar para Bian. Aditiva: una tabla y triggers que marcan el nodo como «sucio»
-- cuando cambia algo que entra en sus fragmentos (publicar, subir y extraer texto, guardar una página,
-- papelera). El job `bian-index` del worker la vacía.

-- CreateTable
CREATE TABLE "ContentChunkDirty" (
    "nodeId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "markedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentChunkDirty_pkey" PRIMARY KEY ("nodeId")
);

-- CreateIndex
CREATE INDEX "ContentChunkDirty_markedAt_idx" ON "ContentChunkDirty"("markedAt");

CREATE OR REPLACE FUNCTION spiderfolio_bian_mark_dirty() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_node text;
BEGIN
  IF TG_TABLE_NAME = 'Node' THEN
    -- Las carpetas no tienen fragmentos.
    IF NEW."type"::text = 'FOLDER' THEN
      RETURN NULL;
    END IF;
    v_node := NEW."id";
  ELSE
    v_node := NEW."nodeId";
  END IF;
  INSERT INTO "ContentChunkDirty" ("nodeId", "workspaceId", "markedAt")
  VALUES (v_node, NEW."workspaceId", now())
  ON CONFLICT ("nodeId") DO UPDATE SET "markedAt" = now();
  RETURN NULL;
END
$$;

CREATE TRIGGER "Node_bian_dirty"
  AFTER INSERT OR UPDATE OF "currentVersion", "trashedAt" ON "Node"
  FOR EACH ROW EXECUTE FUNCTION spiderfolio_bian_mark_dirty();

CREATE TRIGGER "PageContent_bian_dirty"
  AFTER INSERT OR UPDATE OF "content" ON "PageContent"
  FOR EACH ROW EXECUTE FUNCTION spiderfolio_bian_mark_dirty();

CREATE TRIGGER "DocumentVersion_bian_dirty"
  AFTER INSERT OR UPDATE OF "status", "content", "fileVersion" ON "DocumentVersion"
  FOR EACH ROW EXECUTE FUNCTION spiderfolio_bian_mark_dirty();

CREATE TRIGGER "FileText_bian_dirty"
  AFTER INSERT OR UPDATE OF "text", "status" ON "FileText"
  FOR EACH ROW EXECUTE FUNCTION spiderfolio_bian_mark_dirty();

CREATE TRIGGER "ControlledDocument_bian_dirty"
  AFTER INSERT OR UPDATE OF "publishedVersion" ON "ControlledDocument"
  FOR EACH ROW EXECUTE FUNCTION spiderfolio_bian_mark_dirty();
