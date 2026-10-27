-- CreateTable
CREATE TABLE "PageContent" (
    "nodeId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "textPlain" TEXT NOT NULL DEFAULT '',
    "updatedById" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PageContent_pkey" PRIMARY KEY ("nodeId")
);

-- CreateTable
CREATE TABLE "PageImage" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "PageImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PageContent_workspaceId_idx" ON "PageContent"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "PageContent_nodeId_workspaceId_key" ON "PageContent"("nodeId", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "PageImage_storageKey_key" ON "PageImage"("storageKey");

-- CreateIndex
CREATE INDEX "PageImage_workspaceId_nodeId_idx" ON "PageImage"("workspaceId", "nodeId");

-- AddForeignKey
ALTER TABLE "PageContent" ADD CONSTRAINT "PageContent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageContent" ADD CONSTRAINT "PageContent_nodeId_workspaceId_fkey" FOREIGN KEY ("nodeId", "workspaceId") REFERENCES "Node"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageImage" ADD CONSTRAINT "PageImage_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageImage" ADD CONSTRAINT "PageImage_nodeId_workspaceId_fkey" FOREIGN KEY ("nodeId", "workspaceId") REFERENCES "Node"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;
