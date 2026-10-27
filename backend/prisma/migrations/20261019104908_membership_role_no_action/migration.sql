-- DropForeignKey
ALTER TABLE "Membership" DROP CONSTRAINT "Membership_roleId_workspaceId_fkey";

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_roleId_workspaceId_fkey" FOREIGN KEY ("roleId", "workspaceId") REFERENCES "Role"("id", "workspaceId") ON DELETE NO ACTION ON UPDATE CASCADE;
