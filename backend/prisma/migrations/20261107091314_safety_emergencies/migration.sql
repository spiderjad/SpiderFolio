-- CreateEnum
CREATE TYPE "SafetyDrillScenario" AS ENUM ('FIRE', 'EVACUATION', 'SPILL', 'AMMONIA', 'OTHER');

-- AlterEnum
ALTER TYPE "SafetyActionOrigin" ADD VALUE 'DRILL';

-- AlterTable
ALTER TABLE "SafetyAction" ADD COLUMN     "drillId" TEXT;

-- CreateTable
CREATE TABLE "SafetyEmergencyRole" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "courseId" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SafetyEmergencyRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SafetyEmergencyMember" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "location" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SafetyEmergencyMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SafetyDrill" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "scenario" "SafetyDrillScenario" NOT NULL,
    "area" TEXT,
    "announced" BOOLEAN NOT NULL DEFAULT false,
    "participants" INTEGER,
    "evacuationSeconds" INTEGER,
    "incidents" TEXT,
    "observers" TEXT,
    "nodeId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SafetyDrill_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SafetyEmergencyRole_workspaceId_position_idx" ON "SafetyEmergencyRole"("workspaceId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "SafetyEmergencyRole_workspaceId_nameKey_key" ON "SafetyEmergencyRole"("workspaceId", "nameKey");

-- CreateIndex
CREATE UNIQUE INDEX "SafetyEmergencyRole_id_workspaceId_key" ON "SafetyEmergencyRole"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "SafetyEmergencyMember_workspaceId_membershipId_idx" ON "SafetyEmergencyMember"("workspaceId", "membershipId");

-- CreateIndex
CREATE UNIQUE INDEX "SafetyEmergencyMember_roleId_membershipId_key" ON "SafetyEmergencyMember"("roleId", "membershipId");

-- CreateIndex
CREATE INDEX "SafetyDrill_workspaceId_date_id_idx" ON "SafetyDrill"("workspaceId", "date", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SafetyDrill_id_workspaceId_key" ON "SafetyDrill"("id", "workspaceId");

-- AddForeignKey
ALTER TABLE "SafetyAction" ADD CONSTRAINT "SafetyAction_drillId_workspaceId_fkey" FOREIGN KEY ("drillId", "workspaceId") REFERENCES "SafetyDrill"("id", "workspaceId") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "SafetyEmergencyRole" ADD CONSTRAINT "SafetyEmergencyRole_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyEmergencyMember" ADD CONSTRAINT "SafetyEmergencyMember_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyEmergencyMember" ADD CONSTRAINT "SafetyEmergencyMember_roleId_workspaceId_fkey" FOREIGN KEY ("roleId", "workspaceId") REFERENCES "SafetyEmergencyRole"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyDrill" ADD CONSTRAINT "SafetyDrill_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
