-- AlterTable
ALTER TABLE "DocumentVersion" ADD COLUMN "submittedById" TEXT;

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN "version" INTEGER;

-- CreateTable
CREATE TABLE "Approval" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "approverId" TEXT NOT NULL,
    "round" TIMESTAMP(3) NOT NULL,
    "decision" TEXT,
    "comment" TEXT,
    "decidedAt" TIMESTAMP(3),
    "selfApproved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Approval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Approval_nodeId_version_approverId_round_key" ON "Approval"("nodeId", "version", "approverId", "round");

-- CreateIndex
CREATE INDEX "Approval_workspaceId_approverId_decision_idx" ON "Approval"("workspaceId", "approverId", "decision");

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_nodeId_workspaceId_fkey" FOREIGN KEY ("nodeId", "workspaceId") REFERENCES "Node"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;
