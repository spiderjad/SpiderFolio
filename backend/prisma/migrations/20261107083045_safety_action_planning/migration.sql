-- CreateEnum
CREATE TYPE "SafetyActionOrigin" AS ENUM ('INCIDENT', 'RISK_ASSESSMENT', 'INSPECTION', 'OTHER');

-- CreateEnum
CREATE TYPE "SafetyActionPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- AlterTable
ALTER TABLE "SafetyAction" ADD COLUMN     "estimatedCost" INTEGER,
ADD COLUMN     "nodeId" TEXT,
ADD COLUMN     "origin" "SafetyActionOrigin" NOT NULL DEFAULT 'INCIDENT',
ADD COLUMN     "priority" "SafetyActionPriority" NOT NULL DEFAULT 'MEDIUM',
ADD COLUMN     "recordId" TEXT,
ALTER COLUMN "incidentId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "SafetyAction_workspaceId_dueOn_id_idx" ON "SafetyAction"("workspaceId", "dueOn", "id");

-- CreateIndex
CREATE INDEX "SafetyAction_workspaceId_origin_dueOn_idx" ON "SafetyAction"("workspaceId", "origin", "dueOn");

-- An accident's measure always points at its incident, and only those do (Prisma can't express it).
ALTER TABLE "SafetyAction" ADD CONSTRAINT "SafetyAction_incident_origin_check"
  CHECK (("origin" = 'INCIDENT') = ("incidentId" IS NOT NULL));
