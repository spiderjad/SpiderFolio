-- CreateEnum
CREATE TYPE "EnvMeterKind" AS ENUM ('WATER_NETWORK', 'WATER_WELL', 'ELECTRICITY', 'NATURAL_GAS', 'DIESEL', 'LPG', 'OTHER');

-- CreateEnum
CREATE TYPE "EnvCoolingEventKind" AS ENUM ('LEAK_CHECK', 'RECHARGE', 'RECOVERY', 'REPAIR', 'INSPECTION');

-- CreateTable
CREATE TABLE "EnvDischargeLimit" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "permitId" TEXT NOT NULL,
    "parameter" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT '',
    "min" DECIMAL(14,4),
    "max" DECIMAL(14,4),
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "EnvDischargeLimit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnvDischargeSample" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "permitId" TEXT NOT NULL,
    "takenOn" DATE NOT NULL,
    "point" TEXT NOT NULL DEFAULT '',
    "laboratory" TEXT NOT NULL DEFAULT '',
    "values" JSONB NOT NULL,
    "outOfLimits" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT NOT NULL DEFAULT '',
    "ncId" TEXT,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnvDischargeSample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnvMeter" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "EnvMeterKind" NOT NULL,
    "unit" TEXT NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnvMeter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnvReading" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "meterId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "reading" DECIMAL(16,3),
    "consumption" DECIMAL(16,3) NOT NULL,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EnvReading_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnvProduction" (
    "workspaceId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "tonnes" DECIMAL(14,3) NOT NULL,

    CONSTRAINT "EnvProduction_pkey" PRIMARY KEY ("workspaceId","month")
);

-- CreateTable
CREATE TABLE "EnvTarget" (
    "workspaceId" TEXT NOT NULL,
    "meterId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "perTonne" DECIMAL(14,4) NOT NULL,

    CONSTRAINT "EnvTarget_pkey" PRIMARY KEY ("meterId","year")
);

-- CreateTable
CREATE TABLE "EnvCoolingUnit" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location" TEXT NOT NULL DEFAULT '',
    "refrigerant" TEXT NOT NULL,
    "chargeKg" DECIMAL(10,3) NOT NULL,
    "gwp" INTEGER NOT NULL,
    "leakDetection" BOOLEAN NOT NULL DEFAULT false,
    "installer" TEXT NOT NULL DEFAULT '',
    "installedOn" DATE,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EnvCoolingUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnvCoolingEvent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "kind" "EnvCoolingEventKind" NOT NULL,
    "kgAdded" DECIMAL(10,3),
    "kgRecovered" DECIMAL(10,3),
    "leakFound" BOOLEAN,
    "company" TEXT NOT NULL DEFAULT '',
    "certificateRef" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnvCoolingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EnvDischargeLimit_workspaceId_permitId_position_idx" ON "EnvDischargeLimit"("workspaceId", "permitId", "position");

-- CreateIndex
CREATE INDEX "EnvDischargeSample_workspaceId_permitId_takenOn_idx" ON "EnvDischargeSample"("workspaceId", "permitId", "takenOn");

-- CreateIndex
CREATE UNIQUE INDEX "EnvMeter_id_workspaceId_key" ON "EnvMeter"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "EnvReading_workspaceId_month_idx" ON "EnvReading"("workspaceId", "month");

-- CreateIndex
CREATE UNIQUE INDEX "EnvReading_meterId_month_key" ON "EnvReading"("meterId", "month");

-- CreateIndex
CREATE INDEX "EnvTarget_workspaceId_year_idx" ON "EnvTarget"("workspaceId", "year");

-- CreateIndex
CREATE UNIQUE INDEX "EnvCoolingUnit_id_workspaceId_key" ON "EnvCoolingUnit"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "EnvCoolingEvent_workspaceId_unitId_date_idx" ON "EnvCoolingEvent"("workspaceId", "unitId", "date");

-- AddForeignKey
ALTER TABLE "EnvDischargeLimit" ADD CONSTRAINT "EnvDischargeLimit_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnvDischargeSample" ADD CONSTRAINT "EnvDischargeSample_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnvMeter" ADD CONSTRAINT "EnvMeter_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnvReading" ADD CONSTRAINT "EnvReading_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnvReading" ADD CONSTRAINT "EnvReading_meterId_workspaceId_fkey" FOREIGN KEY ("meterId", "workspaceId") REFERENCES "EnvMeter"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnvProduction" ADD CONSTRAINT "EnvProduction_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnvTarget" ADD CONSTRAINT "EnvTarget_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnvTarget" ADD CONSTRAINT "EnvTarget_meterId_workspaceId_fkey" FOREIGN KEY ("meterId", "workspaceId") REFERENCES "EnvMeter"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnvCoolingUnit" ADD CONSTRAINT "EnvCoolingUnit_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnvCoolingEvent" ADD CONSTRAINT "EnvCoolingEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnvCoolingEvent" ADD CONSTRAINT "EnvCoolingEvent_unitId_workspaceId_fkey" FOREIGN KEY ("unitId", "workspaceId") REFERENCES "EnvCoolingUnit"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;
