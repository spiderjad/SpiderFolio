-- CreateTable
CREATE TABLE "SafetyFitness" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "validUntil" DATE,
    "restrictions" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SafetyFitness_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SafetyFitness_workspaceId_membershipId_createdAt_idx" ON "SafetyFitness"("workspaceId", "membershipId", "createdAt");

-- AddForeignKey
ALTER TABLE "SafetyFitness" ADD CONSTRAINT "SafetyFitness_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
