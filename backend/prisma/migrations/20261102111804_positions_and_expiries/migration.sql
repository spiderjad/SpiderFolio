-- AlterTable
ALTER TABLE "Membership" ADD COLUMN     "positionId" TEXT;

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "expiryId" TEXT;

-- CreateTable
CREATE TABLE "Position" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Position_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expiry" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "membershipId" TEXT,
    "responsibleId" TEXT,
    "dueOn" DATE NOT NULL,
    "noticeDays" INTEGER[] DEFAULT ARRAY[30, 7, 0]::INTEGER[],
    "noticesSent" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Expiry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Position_workspaceId_nameKey_key" ON "Position"("workspaceId", "nameKey");

-- CreateIndex
CREATE UNIQUE INDEX "Position_id_workspaceId_key" ON "Position"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "Expiry_workspaceId_dueOn_idx" ON "Expiry"("workspaceId", "dueOn");

-- CreateIndex
CREATE INDEX "Expiry_workspaceId_membershipId_idx" ON "Expiry"("workspaceId", "membershipId");

-- CreateIndex
CREATE UNIQUE INDEX "Expiry_workspaceId_kind_subjectId_key" ON "Expiry"("workspaceId", "kind", "subjectId");

-- CreateIndex
CREATE INDEX "Membership_workspaceId_positionId_idx" ON "Membership"("workspaceId", "positionId");

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expiry" ADD CONSTRAINT "Expiry_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The new safety.manage capability for the existing owner and admin system roles (new companies get it
-- from systemRoles).
UPDATE "Role" SET "capabilities" = array_append("capabilities", 'safety.manage')
WHERE "isSystem" AND "base" IN ('OWNER', 'ADMIN') AND NOT ('safety.manage' = ANY("capabilities"));
