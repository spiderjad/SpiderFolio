-- CreateEnum
CREATE TYPE "QualityNcOrigin" AS ENUM ('INTERNAL', 'CCP', 'AUDIT_INTERNAL', 'AUDIT_EXTERNAL', 'COMPLAINT', 'SUPPLIER', 'OTHER');

-- CreateEnum
CREATE TYPE "QualitySeverity" AS ENUM ('MINOR', 'MAJOR', 'CRITICAL');

-- CreateEnum
CREATE TYPE "QualityNcStatus" AS ENUM ('OPEN', 'ANALYSIS', 'ACTIONS', 'VERIFICATION', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "QualityCauseMethod" AS ENUM ('FIVE_WHYS', 'ISHIKAWA', 'OTHER');

-- CreateEnum
CREATE TYPE "QualityActionKind" AS ENUM ('CORRECTION', 'CORRECTIVE', 'PREVENTIVE');

-- AlterTable
ALTER TABLE "FormSettings" ADD COLUMN     "qualityAutoNc" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "qualityOwnerId" TEXT,
ADD COLUMN     "qualitySeverity" "QualitySeverity";

-- CreateTable
CREATE TABLE "QualityNc" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "origin" "QualityNcOrigin" NOT NULL,
    "severity" "QualitySeverity" NOT NULL,
    "detectedOn" DATE NOT NULL,
    "location" TEXT,
    "departmentId" TEXT,
    "recordId" TEXT,
    "fieldIds" TEXT[],
    "productAffected" BOOLEAN NOT NULL DEFAULT false,
    "productNote" TEXT,
    "correction" TEXT,
    "causeMethod" "QualityCauseMethod",
    "causeAnalysis" JSONB,
    "rootCause" TEXT,
    "status" "QualityNcStatus" NOT NULL DEFAULT 'OPEN',
    "ownerId" TEXT NOT NULL,
    "verifyOn" DATE,
    "cancelReason" TEXT,
    "folderId" TEXT,
    "reportedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,

    CONSTRAINT "QualityNc_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualityNcCounter" (
    "workspaceId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "last" INTEGER NOT NULL,

    CONSTRAINT "QualityNcCounter_pkey" PRIMARY KEY ("workspaceId","year")
);

-- CreateTable
CREATE TABLE "QualityAction" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "ncId" TEXT NOT NULL,
    "kind" "QualityActionKind" NOT NULL,
    "description" TEXT NOT NULL,
    "responsibleId" TEXT NOT NULL,
    "dueOn" DATE NOT NULL,
    "doneAt" TIMESTAMP(3),
    "doneById" TEXT,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QualityAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualityVerification" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "ncId" TEXT NOT NULL,
    "effective" BOOLEAN NOT NULL,
    "note" TEXT NOT NULL,
    "verifiedById" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QualityVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualityNcEvent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "ncId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "actorId" TEXT,
    "data" JSONB NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QualityNcEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QualityNc_workspaceId_status_detectedOn_idx" ON "QualityNc"("workspaceId", "status", "detectedOn");

-- CreateIndex
CREATE INDEX "QualityNc_workspaceId_createdAt_id_idx" ON "QualityNc"("workspaceId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "QualityNc_workspaceId_ownerId_status_idx" ON "QualityNc"("workspaceId", "ownerId", "status");

-- CreateIndex
CREATE INDEX "QualityNc_workspaceId_recordId_idx" ON "QualityNc"("workspaceId", "recordId");

-- CreateIndex
CREATE UNIQUE INDEX "QualityNc_id_workspaceId_key" ON "QualityNc"("id", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "QualityNc_workspaceId_year_number_key" ON "QualityNc"("workspaceId", "year", "number");

-- CreateIndex
CREATE INDEX "QualityAction_workspaceId_ncId_idx" ON "QualityAction"("workspaceId", "ncId");

-- CreateIndex
CREATE INDEX "QualityAction_workspaceId_responsibleId_doneAt_idx" ON "QualityAction"("workspaceId", "responsibleId", "doneAt");

-- CreateIndex
CREATE INDEX "QualityAction_workspaceId_dueOn_id_idx" ON "QualityAction"("workspaceId", "dueOn", "id");

-- CreateIndex
CREATE INDEX "QualityVerification_workspaceId_ncId_verifiedAt_idx" ON "QualityVerification"("workspaceId", "ncId", "verifiedAt");

-- CreateIndex
CREATE INDEX "QualityNcEvent_workspaceId_ncId_at_idx" ON "QualityNcEvent"("workspaceId", "ncId", "at");

-- AddForeignKey
ALTER TABLE "QualityNc" ADD CONSTRAINT "QualityNc_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityNcCounter" ADD CONSTRAINT "QualityNcCounter_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityAction" ADD CONSTRAINT "QualityAction_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityAction" ADD CONSTRAINT "QualityAction_ncId_workspaceId_fkey" FOREIGN KEY ("ncId", "workspaceId") REFERENCES "QualityNc"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityVerification" ADD CONSTRAINT "QualityVerification_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityVerification" ADD CONSTRAINT "QualityVerification_ncId_workspaceId_fkey" FOREIGN KEY ("ncId", "workspaceId") REFERENCES "QualityNc"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityNcEvent" ADD CONSTRAINT "QualityNcEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityNcEvent" ADD CONSTRAINT "QualityNcEvent_ncId_workspaceId_fkey" FOREIGN KEY ("ncId", "workspaceId") REFERENCES "QualityNc"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- The new quality.manage and quality.view capabilities for the existing owner and admin system roles
-- (new companies get them from systemRoles).
UPDATE "Role" SET "capabilities" = array_append("capabilities", 'quality.manage')
WHERE "isSystem" AND "base" IN ('OWNER', 'ADMIN') AND NOT ('quality.manage' = ANY("capabilities"));
UPDATE "Role" SET "capabilities" = array_append("capabilities", 'quality.view')
WHERE "isSystem" AND "base" IN ('OWNER', 'ADMIN') AND NOT ('quality.view' = ANY("capabilities"));
