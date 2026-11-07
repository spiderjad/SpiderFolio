-- CreateEnum
CREATE TYPE "QualityPrpKind" AS ENUM ('CLEANING', 'PEST', 'WATER', 'CALIBRATION', 'GLASS', 'WASTE', 'OTHER');

-- CreateTable
CREATE TABLE "QualityPrp" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" "QualityPrpKind" NOT NULL,
    "name" TEXT NOT NULL,
    "location" TEXT,
    "everyDays" INTEGER NOT NULL,
    "responsibleId" TEXT,
    "formId" TEXT,
    "lastDoneOn" DATE,
    "nextDueOn" DATE NOT NULL,
    "notes" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QualityPrp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualityPrpCheck" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "prpId" TEXT NOT NULL,
    "doneOn" DATE NOT NULL,
    "conforming" BOOLEAN NOT NULL,
    "note" TEXT,
    "ncId" TEXT,
    "doneById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QualityPrpCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QualityPrp_workspaceId_kind_nextDueOn_idx" ON "QualityPrp"("workspaceId", "kind", "nextDueOn");

-- CreateIndex
CREATE UNIQUE INDEX "QualityPrp_id_workspaceId_key" ON "QualityPrp"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "QualityPrpCheck_workspaceId_prpId_doneOn_idx" ON "QualityPrpCheck"("workspaceId", "prpId", "doneOn");

-- CreateIndex
CREATE INDEX "QualityPrpCheck_workspaceId_doneOn_idx" ON "QualityPrpCheck"("workspaceId", "doneOn");

-- AddForeignKey
ALTER TABLE "QualityPrp" ADD CONSTRAINT "QualityPrp_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityPrpCheck" ADD CONSTRAINT "QualityPrpCheck_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityPrpCheck" ADD CONSTRAINT "QualityPrpCheck_prpId_workspaceId_fkey" FOREIGN KEY ("prpId", "workspaceId") REFERENCES "QualityPrp"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;
