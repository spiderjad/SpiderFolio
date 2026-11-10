-- CreateTable
CREATE TABLE "MaintPart" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "codeKey" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'ud',
    "stock" DECIMAL(14,3),
    "minStock" DECIMAL(14,3),
    "location" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaintPart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintIntegrationToken" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "scopes" TEXT[],
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "MaintIntegrationToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MaintPart_workspaceId_active_idx" ON "MaintPart"("workspaceId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "MaintPart_workspaceId_codeKey_key" ON "MaintPart"("workspaceId", "codeKey");

-- CreateIndex
CREATE UNIQUE INDEX "MaintPart_id_workspaceId_key" ON "MaintPart"("id", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "MaintIntegrationToken_tokenHash_key" ON "MaintIntegrationToken"("tokenHash");

-- CreateIndex
CREATE INDEX "MaintIntegrationToken_workspaceId_createdAt_idx" ON "MaintIntegrationToken"("workspaceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MaintIntegrationToken_id_workspaceId_key" ON "MaintIntegrationToken"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "MaintPartUse_workspaceId_createdAt_id_idx" ON "MaintPartUse"("workspaceId", "createdAt", "id");

-- AddForeignKey
ALTER TABLE "MaintPart" ADD CONSTRAINT "MaintPart_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintIntegrationToken" ADD CONSTRAINT "MaintIntegrationToken_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
