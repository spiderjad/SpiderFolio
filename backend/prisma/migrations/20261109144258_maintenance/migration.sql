-- CreateEnum
CREATE TYPE "MaintCriticality" AS ENUM ('A', 'B', 'C');

-- CreateEnum
CREATE TYPE "MaintAssetStatus" AS ENUM ('OPERATING', 'STOPPED', 'RETIRED');

-- CreateEnum
CREATE TYPE "MaintWorkKind" AS ENUM ('CORRECTIVE', 'PREVENTIVE', 'IMPROVEMENT', 'SAFETY', 'HYGIENE');

-- CreateEnum
CREATE TYPE "MaintPriority" AS ENUM ('URGENT', 'HIGH', 'NORMAL', 'LOW');

-- CreateEnum
CREATE TYPE "MaintWorkStatus" AS ENUM ('REPORTED', 'PLANNED', 'IN_PROGRESS', 'ON_HOLD', 'DONE', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MaintSource" AS ENUM ('APP', 'AUDIO', 'QR', 'PREVENTIVE', 'API');

-- AlterEnum
ALTER TYPE "HomeArea" ADD VALUE 'MAINTENANCE';

-- AlterEnum
ALTER TYPE "SpaceArea" ADD VALUE 'MAINTENANCE';

-- CreateTable
CREATE TABLE "MaintAsset" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "codeKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "location" TEXT NOT NULL DEFAULT '',
    "manufacturer" TEXT NOT NULL DEFAULT '',
    "model" TEXT NOT NULL DEFAULT '',
    "serial" TEXT NOT NULL DEFAULT '',
    "installedOn" DATE,
    "criticality" "MaintCriticality" NOT NULL DEFAULT 'B',
    "foodContact" BOOLEAN NOT NULL DEFAULT false,
    "status" "MaintAssetStatus" NOT NULL DEFAULT 'OPERATING',
    "folderId" TEXT,
    "notes" TEXT NOT NULL DEFAULT '',
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaintAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintCounter" (
    "workspaceId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "last" INTEGER NOT NULL,

    CONSTRAINT "MaintCounter_pkey" PRIMARY KEY ("workspaceId","year")
);

-- CreateTable
CREATE TABLE "MaintWorkOrder" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "number" INTEGER NOT NULL,
    "assetId" TEXT,
    "kind" "MaintWorkKind" NOT NULL DEFAULT 'CORRECTIVE',
    "priority" "MaintPriority" NOT NULL DEFAULT 'NORMAL',
    "status" "MaintWorkStatus" NOT NULL DEFAULT 'REPORTED',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "reportedById" TEXT NOT NULL,
    "assignedToId" TEXT,
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueOn" DATE,
    "startedAt" TIMESTAMP(3),
    "doneAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "holdReason" TEXT NOT NULL DEFAULT '',
    "downtimeMinutes" INTEGER,
    "cause" TEXT NOT NULL DEFAULT '',
    "solution" TEXT NOT NULL DEFAULT '',
    "lockout" BOOLEAN NOT NULL DEFAULT false,
    "closedById" TEXT,
    "hygieneReleasedById" TEXT,
    "hygieneReleasedAt" TIMESTAMP(3),
    "source" "MaintSource" NOT NULL DEFAULT 'APP',
    "folderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaintWorkOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintLabor" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "minutes" INTEGER,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaintLabor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintPartUse" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "partCode" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'ud',
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaintPartUse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintEvent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "membershipId" TEXT,
    "action" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaintEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MaintAsset_workspaceId_parentId_idx" ON "MaintAsset"("workspaceId", "parentId");

-- CreateIndex
CREATE UNIQUE INDEX "MaintAsset_id_workspaceId_key" ON "MaintAsset"("id", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "MaintAsset_workspaceId_codeKey_key" ON "MaintAsset"("workspaceId", "codeKey");

-- CreateIndex
CREATE INDEX "MaintWorkOrder_workspaceId_status_priority_idx" ON "MaintWorkOrder"("workspaceId", "status", "priority");

-- CreateIndex
CREATE INDEX "MaintWorkOrder_workspaceId_assetId_reportedAt_idx" ON "MaintWorkOrder"("workspaceId", "assetId", "reportedAt");

-- CreateIndex
CREATE INDEX "MaintWorkOrder_workspaceId_assignedToId_status_idx" ON "MaintWorkOrder"("workspaceId", "assignedToId", "status");

-- CreateIndex
CREATE INDEX "MaintWorkOrder_workspaceId_reportedAt_id_idx" ON "MaintWorkOrder"("workspaceId", "reportedAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "MaintWorkOrder_id_workspaceId_key" ON "MaintWorkOrder"("id", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "MaintWorkOrder_workspaceId_year_number_key" ON "MaintWorkOrder"("workspaceId", "year", "number");

-- CreateIndex
CREATE INDEX "MaintLabor_workspaceId_workOrderId_idx" ON "MaintLabor"("workspaceId", "workOrderId");

-- CreateIndex
CREATE INDEX "MaintLabor_workspaceId_membershipId_endedAt_idx" ON "MaintLabor"("workspaceId", "membershipId", "endedAt");

-- CreateIndex
CREATE INDEX "MaintPartUse_workspaceId_workOrderId_idx" ON "MaintPartUse"("workspaceId", "workOrderId");

-- CreateIndex
CREATE INDEX "MaintEvent_workspaceId_workOrderId_createdAt_idx" ON "MaintEvent"("workspaceId", "workOrderId", "createdAt");

-- AddForeignKey
ALTER TABLE "MaintAsset" ADD CONSTRAINT "MaintAsset_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintCounter" ADD CONSTRAINT "MaintCounter_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintWorkOrder" ADD CONSTRAINT "MaintWorkOrder_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintLabor" ADD CONSTRAINT "MaintLabor_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintLabor" ADD CONSTRAINT "MaintLabor_workOrderId_workspaceId_fkey" FOREIGN KEY ("workOrderId", "workspaceId") REFERENCES "MaintWorkOrder"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintPartUse" ADD CONSTRAINT "MaintPartUse_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintPartUse" ADD CONSTRAINT "MaintPartUse_workOrderId_workspaceId_fkey" FOREIGN KEY ("workOrderId", "workspaceId") REFERENCES "MaintWorkOrder"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintEvent" ADD CONSTRAINT "MaintEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintEvent" ADD CONSTRAINT "MaintEvent_workOrderId_workspaceId_fkey" FOREIGN KEY ("workOrderId", "workspaceId") REFERENCES "MaintWorkOrder"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- The new maintenance capabilities for the existing owner and admin system roles (new companies get
-- them from systemRoles).
UPDATE "Role" SET "capabilities" = array_append("capabilities", 'maintenance.manage')
WHERE "isSystem" AND "base" IN ('OWNER', 'ADMIN') AND NOT ('maintenance.manage' = ANY("capabilities"));
UPDATE "Role" SET "capabilities" = array_append("capabilities", 'maintenance.work')
WHERE "isSystem" AND "base" IN ('OWNER', 'ADMIN') AND NOT ('maintenance.work' = ANY("capabilities"));
UPDATE "Role" SET "capabilities" = array_append("capabilities", 'maintenance.view')
WHERE "isSystem" AND "base" IN ('OWNER', 'ADMIN') AND NOT ('maintenance.view' = ANY("capabilities"));
