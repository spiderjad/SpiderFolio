-- CreateEnum
CREATE TYPE "TemplateKind" AS ENUM ('PAGE', 'FOLDER');

-- CreateTable
CREATE TABLE "Template" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "category" TEXT,
    "kind" "TemplateKind" NOT NULL,
    "snapshot" JSONB NOT NULL,
    "nodeCount" INTEGER NOT NULL,
    "skippedFiles" INTEGER NOT NULL DEFAULT 0,
    "packKey" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemplateImage" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TemplateImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Template_workspaceId_packKey_idx" ON "Template"("workspaceId", "packKey");

-- CreateIndex
CREATE UNIQUE INDEX "Template_id_workspaceId_key" ON "Template"("id", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Template_workspaceId_nameKey_key" ON "Template"("workspaceId", "nameKey");

-- CreateIndex
CREATE UNIQUE INDEX "TemplateImage_storageKey_key" ON "TemplateImage"("storageKey");

-- CreateIndex
CREATE INDEX "TemplateImage_workspaceId_templateId_idx" ON "TemplateImage"("workspaceId", "templateId");

-- AddForeignKey
ALTER TABLE "Template" ADD CONSTRAINT "Template_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateImage" ADD CONSTRAINT "TemplateImage_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateImage" ADD CONSTRAINT "TemplateImage_templateId_workspaceId_fkey" FOREIGN KEY ("templateId", "workspaceId") REFERENCES "Template"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;
