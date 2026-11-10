-- AlterEnum
ALTER TYPE "MaintSource" ADD VALUE 'QUALITY';

-- AlterTable
ALTER TABLE "MaintWorkOrder" ADD COLUMN     "ncId" TEXT;

-- CreateIndex
CREATE INDEX "MaintWorkOrder_workspaceId_ncId_idx" ON "MaintWorkOrder"("workspaceId", "ncId");
