-- CreateTable
CREATE TABLE "DocumentVisit" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "visitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentVisit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DocumentVisit_membershipId_nodeId_key" ON "DocumentVisit"("membershipId", "nodeId");

-- CreateIndex
CREATE INDEX "DocumentVisit_workspaceId_membershipId_visitedAt_idx" ON "DocumentVisit"("workspaceId", "membershipId", "visitedAt");

-- AddForeignKey
ALTER TABLE "DocumentVisit" ADD CONSTRAINT "DocumentVisit_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentVisit" ADD CONSTRAINT "DocumentVisit_nodeId_workspaceId_fkey" FOREIGN KEY ("nodeId", "workspaceId") REFERENCES "Node"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;
