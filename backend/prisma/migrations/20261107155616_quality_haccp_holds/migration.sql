-- CreateEnum
CREATE TYPE "QualityHazardType" AS ENUM ('BIOLOGICAL', 'CHEMICAL', 'PHYSICAL', 'ALLERGEN');

-- CreateEnum
CREATE TYPE "QualityHoldStatus" AS ENUM ('HELD', 'RELEASED', 'REWORKED', 'DIVERTED', 'DESTROYED');

-- CreateTable
CREATE TABLE "QualityCcp" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "codeKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "hazard" TEXT NOT NULL,
    "hazardType" "QualityHazardType" NOT NULL,
    "criticalLimit" TEXT NOT NULL,
    "formId" TEXT,
    "frequency" TEXT NOT NULL,
    "responsibleId" TEXT,
    "correctiveAction" TEXT NOT NULL,
    "verification" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QualityCcp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualityHold" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "ncId" TEXT,
    "product" TEXT NOT NULL,
    "lot" TEXT,
    "quantity" TEXT,
    "location" TEXT,
    "reason" TEXT NOT NULL,
    "status" "QualityHoldStatus" NOT NULL DEFAULT 'HELD',
    "decisionNote" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "signature" BYTEA,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QualityHold_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QualityCcp_workspaceId_position_idx" ON "QualityCcp"("workspaceId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "QualityCcp_workspaceId_codeKey_key" ON "QualityCcp"("workspaceId", "codeKey");

-- CreateIndex
CREATE INDEX "QualityHold_workspaceId_status_createdAt_idx" ON "QualityHold"("workspaceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "QualityHold_workspaceId_ncId_idx" ON "QualityHold"("workspaceId", "ncId");

-- AddForeignKey
ALTER TABLE "QualityCcp" ADD CONSTRAINT "QualityCcp_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityHold" ADD CONSTRAINT "QualityHold_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityHold" ADD CONSTRAINT "QualityHold_ncId_workspaceId_fkey" FOREIGN KEY ("ncId", "workspaceId") REFERENCES "QualityNc"("id", "workspaceId") ON DELETE NO ACTION ON UPDATE NO ACTION;
