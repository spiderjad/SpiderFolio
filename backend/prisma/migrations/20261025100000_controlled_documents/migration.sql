-- CreateEnum
CREATE TYPE "DocStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED', 'PUBLISHED', 'OBSOLETE');

-- CreateTable
CREATE TABLE "DocumentType" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "padding" INTEGER NOT NULL DEFAULT 3,
    "nextNumber" INTEGER NOT NULL DEFAULT 1,
    "reviewMonths" INTEGER NOT NULL DEFAULT 12,
    "approverRule" TEXT NOT NULL DEFAULT 'OWNER_HEAD',
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DocumentType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ControlledDocument" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "ownerDepartmentId" TEXT,
    "reviewDueAt" TIMESTAMP(3),
    "publishedVersion" INTEGER,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ControlledDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentVersion" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "DocStatus" NOT NULL DEFAULT 'DRAFT',
    "title" TEXT NOT NULL,
    "changeNote" TEXT,
    "content" JSONB,
    "fileVersion" INTEGER,
    "checksum" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "effectiveAt" TIMESTAMP(3),
    "obsoletedAt" TIMESTAMP(3),
    "pdfKey" TEXT,

    CONSTRAINT "DocumentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DocumentType_workspaceId_code_key" ON "DocumentType"("workspaceId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ControlledDocument_nodeId_key" ON "ControlledDocument"("nodeId");

-- CreateIndex
CREATE UNIQUE INDEX "ControlledDocument_workspaceId_code_key" ON "ControlledDocument"("workspaceId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ControlledDocument_nodeId_workspaceId_key" ON "ControlledDocument"("nodeId", "workspaceId");

-- CreateIndex
CREATE INDEX "ControlledDocument_workspaceId_ownerDepartmentId_idx" ON "ControlledDocument"("workspaceId", "ownerDepartmentId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentVersion_nodeId_version_key" ON "DocumentVersion"("nodeId", "version");

-- CreateIndex
CREATE INDEX "DocumentVersion_workspaceId_nodeId_status_idx" ON "DocumentVersion"("workspaceId", "nodeId", "status");

-- Una sola versión vigente (PUBLISHED) por documento (Prisma no expresa índices parciales).
CREATE UNIQUE INDEX "DocumentVersion_one_published_idx" ON "DocumentVersion"("nodeId") WHERE "status" = 'PUBLISHED';

-- AddForeignKey
ALTER TABLE "DocumentType" ADD CONSTRAINT "DocumentType_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlledDocument" ADD CONSTRAINT "ControlledDocument_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlledDocument" ADD CONSTRAINT "ControlledDocument_nodeId_workspaceId_fkey" FOREIGN KEY ("nodeId", "workspaceId") REFERENCES "Node"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_nodeId_workspaceId_fkey" FOREIGN KEY ("nodeId", "workspaceId") REFERENCES "Node"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;
