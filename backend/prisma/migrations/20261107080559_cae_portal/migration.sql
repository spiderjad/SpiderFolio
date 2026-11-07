-- AlterTable
ALTER TABLE "CaeDocument" ADD COLUMN     "portalAccessId" TEXT;

-- CreateTable
CREATE TABLE "CaePortalAccess" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaePortalAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaePortalSession" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "accessId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaePortalSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaePortalUpload" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "accessId" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "workerId" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaePortalUpload_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CaePortalAccess_workspaceId_companyId_createdAt_idx" ON "CaePortalAccess"("workspaceId", "companyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CaePortalAccess_id_workspaceId_key" ON "CaePortalAccess"("id", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "CaePortalSession_tokenHash_key" ON "CaePortalSession"("tokenHash");

-- CreateIndex
CREATE INDEX "CaePortalSession_workspaceId_accessId_idx" ON "CaePortalSession"("workspaceId", "accessId");

-- CreateIndex
CREATE INDEX "CaePortalUpload_workspaceId_accessId_idx" ON "CaePortalUpload"("workspaceId", "accessId");

-- AddForeignKey
ALTER TABLE "CaeDocument" ADD CONSTRAINT "CaeDocument_portalAccessId_workspaceId_fkey" FOREIGN KEY ("portalAccessId", "workspaceId") REFERENCES "CaePortalAccess"("id", "workspaceId") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "CaePortalAccess" ADD CONSTRAINT "CaePortalAccess_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaePortalAccess" ADD CONSTRAINT "CaePortalAccess_companyId_workspaceId_fkey" FOREIGN KEY ("companyId", "workspaceId") REFERENCES "CaeCompany"("id", "workspaceId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaePortalSession" ADD CONSTRAINT "CaePortalSession_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaePortalSession" ADD CONSTRAINT "CaePortalSession_accessId_workspaceId_fkey" FOREIGN KEY ("accessId", "workspaceId") REFERENCES "CaePortalAccess"("id", "workspaceId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaePortalUpload" ADD CONSTRAINT "CaePortalUpload_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaePortalUpload" ADD CONSTRAINT "CaePortalUpload_accessId_workspaceId_fkey" FOREIGN KEY ("accessId", "workspaceId") REFERENCES "CaePortalAccess"("id", "workspaceId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- One active (not revoked) portal access per contractor (Prisma can't express a partial unique index).
CREATE UNIQUE INDEX "CaePortalAccess_one_active_per_company" ON "CaePortalAccess"("workspaceId", "companyId") WHERE "revokedAt" IS NULL;
