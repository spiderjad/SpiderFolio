-- CreateEnum
CREATE TYPE "CaeCompanyKind" AS ENUM ('CONTRACTOR', 'SUBCONTRACTOR', 'CONCURRENT');

-- CreateEnum
CREATE TYPE "CaeScope" AS ENUM ('COMPANY', 'WORKER');

-- CreateEnum
CREATE TYPE "CaeAppliesTo" AS ENUM ('ALL', 'CONTRACTOR', 'CONCURRENT');

-- CreateTable
CREATE TABLE "CaeCompany" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "taxId" TEXT,
    "kind" "CaeCompanyKind" NOT NULL,
    "parentId" TEXT,
    "activity" TEXT NOT NULL,
    "contactName" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "responsibleId" TEXT NOT NULL,
    "startsOn" DATE,
    "endsOn" DATE,
    "blockedAt" TIMESTAMP(3),
    "blockedReason" TEXT,
    "archivedAt" TIMESTAMP(3),
    "folderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CaeCompany_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaeWorker" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "idNumber" TEXT,
    "task" TEXT,
    "blockedAt" TIMESTAMP(3),
    "blockedReason" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CaeWorker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaeRequirement" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "scope" "CaeScope" NOT NULL,
    "validityMonths" INTEGER,
    "appliesTo" "CaeAppliesTo" NOT NULL DEFAULT 'ALL',
    "required" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" TIMESTAMP(3),
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CaeRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CaeCompany_workspaceId_name_id_idx" ON "CaeCompany"("workspaceId", "name", "id");

-- CreateIndex
CREATE INDEX "CaeCompany_workspaceId_responsibleId_idx" ON "CaeCompany"("workspaceId", "responsibleId");

-- CreateIndex
CREATE INDEX "CaeCompany_workspaceId_parentId_idx" ON "CaeCompany"("workspaceId", "parentId");

-- CreateIndex
CREATE UNIQUE INDEX "CaeCompany_workspaceId_nameKey_key" ON "CaeCompany"("workspaceId", "nameKey");

-- CreateIndex
CREATE UNIQUE INDEX "CaeCompany_id_workspaceId_key" ON "CaeCompany"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "CaeWorker_workspaceId_companyId_name_id_idx" ON "CaeWorker"("workspaceId", "companyId", "name", "id");

-- CreateIndex
CREATE INDEX "CaeWorker_workspaceId_name_id_idx" ON "CaeWorker"("workspaceId", "name", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CaeWorker_id_workspaceId_key" ON "CaeWorker"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "CaeRequirement_workspaceId_scope_position_id_idx" ON "CaeRequirement"("workspaceId", "scope", "position", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CaeRequirement_workspaceId_nameKey_key" ON "CaeRequirement"("workspaceId", "nameKey");

-- CreateIndex
CREATE UNIQUE INDEX "CaeRequirement_id_workspaceId_key" ON "CaeRequirement"("id", "workspaceId");

-- AddForeignKey
ALTER TABLE "CaeCompany" ADD CONSTRAINT "CaeCompany_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaeCompany" ADD CONSTRAINT "CaeCompany_parentId_workspaceId_fkey" FOREIGN KEY ("parentId", "workspaceId") REFERENCES "CaeCompany"("id", "workspaceId") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "CaeWorker" ADD CONSTRAINT "CaeWorker_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaeWorker" ADD CONSTRAINT "CaeWorker_companyId_workspaceId_fkey" FOREIGN KEY ("companyId", "workspaceId") REFERENCES "CaeCompany"("id", "workspaceId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaeRequirement" ADD CONSTRAINT "CaeRequirement_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The new cae.manage and cae.check capabilities for the existing owner and admin system roles (new
-- companies get them from systemRoles).
UPDATE "Role" SET "capabilities" = array_append("capabilities", 'cae.manage')
WHERE "isSystem" AND "base" IN ('OWNER', 'ADMIN') AND NOT ('cae.manage' = ANY("capabilities"));
UPDATE "Role" SET "capabilities" = array_append("capabilities", 'cae.check')
WHERE "isSystem" AND "base" IN ('OWNER', 'ADMIN') AND NOT ('cae.check' = ANY("capabilities"));
