-- CreateEnum
CREATE TYPE "MaintRecordingPurpose" AS ENUM ('REPORT', 'CLOSE');

-- CreateTable
CREATE TABLE "MaintRecording" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "workOrderId" TEXT,
    "purpose" "MaintRecordingPurpose" NOT NULL,
    "membershipId" TEXT NOT NULL,
    "storageKey" TEXT,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "durationMs" INTEGER,
    "transcript" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaintRecording_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MaintRecording_workspaceId_workOrderId_createdAt_idx" ON "MaintRecording"("workspaceId", "workOrderId", "createdAt");

-- CreateIndex
CREATE INDEX "MaintRecording_createdAt_idx" ON "MaintRecording"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MaintRecording_id_workspaceId_key" ON "MaintRecording"("id", "workspaceId");

-- AddForeignKey
ALTER TABLE "MaintRecording" ADD CONSTRAINT "MaintRecording_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintRecording" ADD CONSTRAINT "MaintRecording_workOrderId_workspaceId_fkey" FOREIGN KEY ("workOrderId", "workspaceId") REFERENCES "MaintWorkOrder"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;
