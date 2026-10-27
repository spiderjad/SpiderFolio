-- AlterTable
ALTER TABLE "Space" ADD COLUMN     "departmentId" TEXT,
ADD COLUMN     "departmentLevel" "AccessLevel" NOT NULL DEFAULT 'EDIT';

-- CreateIndex
CREATE INDEX "Space_workspaceId_departmentId_idx" ON "Space"("workspaceId", "departmentId");

-- AddForeignKey
ALTER TABLE "Space" ADD CONSTRAINT "Space_departmentId_workspaceId_fkey" FOREIGN KEY ("departmentId", "workspaceId") REFERENCES "Department"("id", "workspaceId") ON DELETE NO ACTION ON UPDATE CASCADE;
