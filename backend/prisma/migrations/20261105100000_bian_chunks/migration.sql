-- Bian, el asistente IA: fragmentos de la versión vigente (solo texto completo por ahora) y contador de
-- consultas por período. Aditiva.

-- CreateTable
CREATE TABLE "ContentChunk" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "version" INTEGER,
    "seq" INTEGER NOT NULL,
    "heading" TEXT,
    "text" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "tokens" INTEGER NOT NULL,
    "tsv" tsvector GENERATED ALWAYS AS (to_tsvector('es_unaccent'::regconfig, "text")) STORED,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageCounter" (
    "workspaceId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "aiQueries" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "UsageCounter_pkey" PRIMARY KEY ("workspaceId","periodStart")
);

-- CreateIndex
CREATE UNIQUE INDEX "ContentChunk_nodeId_seq_key" ON "ContentChunk"("nodeId", "seq");

-- CreateIndex
CREATE INDEX "ContentChunk_workspaceId_nodeId_idx" ON "ContentChunk"("workspaceId", "nodeId");

-- CreateIndex
CREATE INDEX "ContentChunk_tsv_idx" ON "ContentChunk" USING GIN ("tsv");

-- AddForeignKey
ALTER TABLE "ContentChunk" ADD CONSTRAINT "ContentChunk_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentChunk" ADD CONSTRAINT "ContentChunk_nodeId_workspaceId_fkey" FOREIGN KEY ("nodeId", "workspaceId") REFERENCES "Node"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageCounter" ADD CONSTRAINT "UsageCounter_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
