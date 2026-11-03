-- AlterTable
ALTER TABLE "SafetyTraining" ADD COLUMN     "sessionId" TEXT;

-- CreateTable
CREATE TABLE "SafetySignSession" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "completedOn" DATE NOT NULL,
    "attendeeIds" TEXT[],
    "createdById" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SafetySignSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SafetySignSession_workspaceId_courseId_idx" ON "SafetySignSession"("workspaceId", "courseId");

-- CreateIndex
CREATE UNIQUE INDEX "SafetyTraining_sessionId_membershipId_key" ON "SafetyTraining"("sessionId", "membershipId");

-- AddForeignKey
ALTER TABLE "SafetySignSession" ADD CONSTRAINT "SafetySignSession_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetySignSession" ADD CONSTRAINT "SafetySignSession_courseId_workspaceId_fkey" FOREIGN KEY ("courseId", "workspaceId") REFERENCES "SafetyCourse"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

