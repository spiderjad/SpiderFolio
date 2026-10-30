-- CreateTable
CREATE TABLE "FormRecord" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "answers" JSONB NOT NULL,
    "nonConforming" TEXT[],
    "source" TEXT NOT NULL,
    "submittedById" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "voidReason" TEXT,

    CONSTRAINT "FormRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormFile" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "fieldId" TEXT NOT NULL,
    "recordId" TEXT,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "FormFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FormRecord_workspaceId_nodeId_submittedAt_idx" ON "FormRecord"("workspaceId", "nodeId", "submittedAt");

-- CreateIndex
CREATE INDEX "FormRecord_workspaceId_submittedById_idx" ON "FormRecord"("workspaceId", "submittedById");

-- CreateIndex
CREATE UNIQUE INDEX "FormRecord_id_workspaceId_key" ON "FormRecord"("id", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "FormFile_storageKey_key" ON "FormFile"("storageKey");

-- CreateIndex
CREATE INDEX "FormFile_workspaceId_recordId_idx" ON "FormFile"("workspaceId", "recordId");

-- CreateIndex
CREATE INDEX "FormFile_confirmedAt_createdAt_idx" ON "FormFile"("confirmedAt", "createdAt");

-- AddForeignKey
ALTER TABLE "FormRecord" ADD CONSTRAINT "FormRecord_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormRecord" ADD CONSTRAINT "FormRecord_nodeId_workspaceId_fkey" FOREIGN KEY ("nodeId", "workspaceId") REFERENCES "Node"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormFile" ADD CONSTRAINT "FormFile_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormFile" ADD CONSTRAINT "FormFile_nodeId_workspaceId_fkey" FOREIGN KEY ("nodeId", "workspaceId") REFERENCES "Node"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormFile" ADD CONSTRAINT "FormFile_recordId_workspaceId_fkey" FOREIGN KEY ("recordId", "workspaceId") REFERENCES "FormRecord"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;
