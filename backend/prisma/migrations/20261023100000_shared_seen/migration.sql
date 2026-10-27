-- CreateTable
CREATE TABLE "SharedSeen" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SharedSeen_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SharedSeen_membershipId_nodeId_key" ON "SharedSeen"("membershipId", "nodeId");

-- CreateIndex
CREATE INDEX "SharedSeen_workspaceId_membershipId_idx" ON "SharedSeen"("workspaceId", "membershipId");

-- AddForeignKey
ALTER TABLE "SharedSeen" ADD CONSTRAINT "SharedSeen_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharedSeen" ADD CONSTRAINT "SharedSeen_nodeId_workspaceId_fkey" FOREIGN KEY ("nodeId", "workspaceId") REFERENCES "Node"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;
