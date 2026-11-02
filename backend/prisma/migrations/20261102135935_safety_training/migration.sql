-- AlterTable
ALTER TABLE "ReadRequirement" ADD COLUMN     "positionId" TEXT;

-- CreateTable
CREATE TABLE "SafetyCourse" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "validityMonths" INTEGER,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SafetyCourse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SafetyTraining" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "validUntil" DATE,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SafetyTraining_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SafetyCourse_workspaceId_nodeId_key" ON "SafetyCourse"("workspaceId", "nodeId");

-- CreateIndex
CREATE UNIQUE INDEX "SafetyCourse_id_workspaceId_key" ON "SafetyCourse"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "SafetyTraining_workspaceId_courseId_membershipId_idx" ON "SafetyTraining"("workspaceId", "courseId", "membershipId");

-- CreateIndex
CREATE INDEX "SafetyTraining_workspaceId_membershipId_idx" ON "SafetyTraining"("workspaceId", "membershipId");

-- AddForeignKey
ALTER TABLE "SafetyCourse" ADD CONSTRAINT "SafetyCourse_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyTraining" ADD CONSTRAINT "SafetyTraining_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyTraining" ADD CONSTRAINT "SafetyTraining_courseId_workspaceId_fkey" FOREIGN KEY ("courseId", "workspaceId") REFERENCES "SafetyCourse"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- One requirement per position, like the department and person ones.
CREATE UNIQUE INDEX "ReadRequirement_position_key" ON "ReadRequirement"("nodeId", "version", "positionId") WHERE "positionId" IS NOT NULL;

-- A requirement is for exactly one subject: a department, a person or a position.
ALTER TABLE "ReadRequirement" DROP CONSTRAINT "ReadRequirement_one_subject";
ALTER TABLE "ReadRequirement" ADD CONSTRAINT "ReadRequirement_one_subject" CHECK (
  num_nonnulls("departmentId", "membershipId", "positionId") = 1
);
