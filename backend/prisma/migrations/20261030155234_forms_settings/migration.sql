-- AlterTable
ALTER TABLE "FormRecord" ADD COLUMN     "periodKey" TEXT;

-- CreateTable
CREATE TABLE "FormSettings" (
    "nodeId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "responsibleMembershipId" TEXT,
    "responsibleDepartmentId" TEXT,
    "frequency" TEXT NOT NULL DEFAULT 'none',
    "weekdays" INTEGER[],
    "assigneeMembershipIds" TEXT[],
    "assigneeDepartmentIds" TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FormSettings_pkey" PRIMARY KEY ("nodeId")
);

-- CreateIndex
CREATE INDEX "FormSettings_workspaceId_frequency_idx" ON "FormSettings"("workspaceId", "frequency");

-- CreateIndex
CREATE UNIQUE INDEX "FormSettings_nodeId_workspaceId_key" ON "FormSettings"("nodeId", "workspaceId");

-- CreateIndex
CREATE INDEX "FormRecord_workspaceId_nodeId_periodKey_idx" ON "FormRecord"("workspaceId", "nodeId", "periodKey");

-- AddForeignKey
ALTER TABLE "FormSettings" ADD CONSTRAINT "FormSettings_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormSettings" ADD CONSTRAINT "FormSettings_nodeId_workspaceId_fkey" FOREIGN KEY ("nodeId", "workspaceId") REFERENCES "Node"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;
