-- CreateEnum
CREATE TYPE "MaintPlanKind" AS ENUM ('PREVENTIVE', 'CALIBRATION');

-- CreateEnum
CREATE TYPE "MaintPlanUnit" AS ENUM ('DAYS', 'WEEKS', 'MONTHS');

-- AlterEnum
ALTER TYPE "MaintWorkKind" ADD VALUE 'CALIBRATION';

-- AlterTable
ALTER TABLE "MaintWorkOrder" ADD COLUMN     "checklist" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "planId" TEXT;

-- CreateTable
CREATE TABLE "MaintPlan" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "kind" "MaintPlanKind" NOT NULL DEFAULT 'PREVENTIVE',
    "name" TEXT NOT NULL,
    "instructions" TEXT NOT NULL DEFAULT '',
    "checklist" TEXT[],
    "every" INTEGER,
    "everyUnit" "MaintPlanUnit",
    "meterId" TEXT,
    "meterEvery" INTEGER,
    "assignedToId" TEXT,
    "estimatedMinutes" INTEGER,
    "leadDays" INTEGER NOT NULL DEFAULT 3,
    "lockout" BOOLEAN NOT NULL DEFAULT false,
    "nextDueOn" DATE,
    "nextMeterAt" INTEGER,
    "lastDoneOn" DATE,
    "archivedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaintPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintMeter" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "lastValue" INTEGER,
    "lastReadAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaintMeter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintMeterReading" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "meterId" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "membershipId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaintMeterReading_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MaintPlan_workspaceId_assetId_idx" ON "MaintPlan"("workspaceId", "assetId");

-- CreateIndex
CREATE INDEX "MaintPlan_workspaceId_archivedAt_nextDueOn_idx" ON "MaintPlan"("workspaceId", "archivedAt", "nextDueOn");

-- CreateIndex
CREATE UNIQUE INDEX "MaintPlan_id_workspaceId_key" ON "MaintPlan"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "MaintMeter_workspaceId_assetId_idx" ON "MaintMeter"("workspaceId", "assetId");

-- CreateIndex
CREATE UNIQUE INDEX "MaintMeter_id_workspaceId_key" ON "MaintMeter"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "MaintMeterReading_workspaceId_meterId_readAt_idx" ON "MaintMeterReading"("workspaceId", "meterId", "readAt");

-- CreateIndex
CREATE INDEX "MaintWorkOrder_workspaceId_planId_status_idx" ON "MaintWorkOrder"("workspaceId", "planId", "status");

-- AddForeignKey
ALTER TABLE "MaintPlan" ADD CONSTRAINT "MaintPlan_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintMeter" ADD CONSTRAINT "MaintMeter_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintMeterReading" ADD CONSTRAINT "MaintMeterReading_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintMeterReading" ADD CONSTRAINT "MaintMeterReading_meterId_workspaceId_fkey" FOREIGN KEY ("meterId", "workspaceId") REFERENCES "MaintMeter"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;
