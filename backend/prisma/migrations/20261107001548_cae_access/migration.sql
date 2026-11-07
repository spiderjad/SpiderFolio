-- CreateEnum
CREATE TYPE "CaeAccessDirection" AS ENUM ('IN', 'OUT');

-- CreateTable
CREATE TABLE "CaeAccess" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "direction" "CaeAccessDirection" NOT NULL,
    "authorized" BOOLEAN NOT NULL,
    "reasons" TEXT[],
    "createdById" TEXT NOT NULL,

    CONSTRAINT "CaeAccess_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CaeAccess_workspaceId_at_id_idx" ON "CaeAccess"("workspaceId", "at", "id");

-- CreateIndex
CREATE INDEX "CaeAccess_workspaceId_companyId_at_idx" ON "CaeAccess"("workspaceId", "companyId", "at");

-- CreateIndex
CREATE INDEX "CaeAccess_workspaceId_workerId_at_idx" ON "CaeAccess"("workspaceId", "workerId", "at");

-- AddForeignKey
ALTER TABLE "CaeAccess" ADD CONSTRAINT "CaeAccess_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaeAccess" ADD CONSTRAINT "CaeAccess_workerId_workspaceId_fkey" FOREIGN KEY ("workerId", "workspaceId") REFERENCES "CaeWorker"("id", "workspaceId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaeAccess" ADD CONSTRAINT "CaeAccess_companyId_workspaceId_fkey" FOREIGN KEY ("companyId", "workspaceId") REFERENCES "CaeCompany"("id", "workspaceId") ON DELETE NO ACTION ON UPDATE CASCADE;
