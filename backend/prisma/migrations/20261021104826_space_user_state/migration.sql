-- CreateTable
CREATE TABLE "SpaceUserState" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "favorite" BOOLEAN NOT NULL DEFAULT false,
    "visitedAt" TIMESTAMP(3),

    CONSTRAINT "SpaceUserState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SpaceUserState_workspaceId_membershipId_favorite_idx" ON "SpaceUserState"("workspaceId", "membershipId", "favorite");

-- CreateIndex
CREATE INDEX "SpaceUserState_workspaceId_membershipId_visitedAt_idx" ON "SpaceUserState"("workspaceId", "membershipId", "visitedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SpaceUserState_spaceId_membershipId_key" ON "SpaceUserState"("spaceId", "membershipId");

-- AddForeignKey
ALTER TABLE "SpaceUserState" ADD CONSTRAINT "SpaceUserState_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaceUserState" ADD CONSTRAINT "SpaceUserState_spaceId_workspaceId_fkey" FOREIGN KEY ("spaceId", "workspaceId") REFERENCES "Space"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaceUserState" ADD CONSTRAINT "SpaceUserState_membershipId_workspaceId_fkey" FOREIGN KEY ("membershipId", "workspaceId") REFERENCES "Membership"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;
