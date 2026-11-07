-- CreateEnum
CREATE TYPE "CaeDocumentStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

-- AlterTable
ALTER TABLE "CaeWorker" ADD COLUMN     "folderId" TEXT;

-- CreateTable
CREATE TABLE "CaeDocument" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "workerId" TEXT,
    "nodeId" TEXT NOT NULL,
    "validUntil" DATE,
    "status" "CaeDocumentStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "supersededAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CaeDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CaeDocument_workspaceId_companyId_workerId_requirementId_cr_idx" ON "CaeDocument"("workspaceId", "companyId", "workerId", "requirementId", "createdAt");

-- CreateIndex
CREATE INDEX "CaeDocument_workspaceId_workerId_requirementId_createdAt_idx" ON "CaeDocument"("workspaceId", "workerId", "requirementId", "createdAt");

-- CreateIndex
CREATE INDEX "CaeDocument_workspaceId_status_createdAt_id_idx" ON "CaeDocument"("workspaceId", "status", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CaeDocument_id_workspaceId_key" ON "CaeDocument"("id", "workspaceId");

-- AddForeignKey
ALTER TABLE "CaeDocument" ADD CONSTRAINT "CaeDocument_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaeDocument" ADD CONSTRAINT "CaeDocument_requirementId_workspaceId_fkey" FOREIGN KEY ("requirementId", "workspaceId") REFERENCES "CaeRequirement"("id", "workspaceId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaeDocument" ADD CONSTRAINT "CaeDocument_companyId_workspaceId_fkey" FOREIGN KEY ("companyId", "workspaceId") REFERENCES "CaeCompany"("id", "workspaceId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaeDocument" ADD CONSTRAINT "CaeDocument_workerId_workspaceId_fkey" FOREIGN KEY ("workerId", "workspaceId") REFERENCES "CaeWorker"("id", "workspaceId") ON DELETE NO ACTION ON UPDATE NO ACTION;
