-- CreateEnum
CREATE TYPE "QualityAuditScheme" AS ENUM ('INTERNAL', 'IFS8', 'BRCGS9', 'CLIENT', 'OFFICIAL', 'OTHER');

-- CreateEnum
CREATE TYPE "QualityAuditStatus" AS ENUM ('PLANNED', 'DONE', 'CANCELLED');

-- CreateTable
CREATE TABLE "QualityAudit" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "scheme" "QualityAuditScheme" NOT NULL,
    "title" TEXT NOT NULL,
    "scope" TEXT,
    "plannedOn" DATE NOT NULL,
    "doneOn" DATE,
    "auditor" TEXT,
    "leadId" TEXT,
    "chapters" TEXT[],
    "status" "QualityAuditStatus" NOT NULL DEFAULT 'PLANNED',
    "result" TEXT,
    "auditRoomId" TEXT,
    "cancelReason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QualityAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualityFinding" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "clause" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "severity" "QualitySeverity" NOT NULL,
    "ncId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QualityFinding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QualityAudit_workspaceId_plannedOn_id_idx" ON "QualityAudit"("workspaceId", "plannedOn", "id");

-- CreateIndex
CREATE UNIQUE INDEX "QualityAudit_id_workspaceId_key" ON "QualityAudit"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "QualityFinding_workspaceId_auditId_idx" ON "QualityFinding"("workspaceId", "auditId");

-- CreateIndex
CREATE INDEX "QualityFinding_workspaceId_ncId_idx" ON "QualityFinding"("workspaceId", "ncId");

-- AddForeignKey
ALTER TABLE "QualityAudit" ADD CONSTRAINT "QualityAudit_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityFinding" ADD CONSTRAINT "QualityFinding_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityFinding" ADD CONSTRAINT "QualityFinding_auditId_workspaceId_fkey" FOREIGN KEY ("auditId", "workspaceId") REFERENCES "QualityAudit"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityFinding" ADD CONSTRAINT "QualityFinding_ncId_workspaceId_fkey" FOREIGN KEY ("ncId", "workspaceId") REFERENCES "QualityNc"("id", "workspaceId") ON DELETE NO ACTION ON UPDATE NO ACTION;
