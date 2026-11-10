-- CreateTable
CREATE TABLE "MaintSuggestion" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "useful" BOOLEAN,
    "model" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaintSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MaintSuggestion_workspaceId_workOrderId_createdAt_idx" ON "MaintSuggestion"("workspaceId", "workOrderId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MaintSuggestion_id_workspaceId_key" ON "MaintSuggestion"("id", "workspaceId");

-- AddForeignKey
ALTER TABLE "MaintSuggestion" ADD CONSTRAINT "MaintSuggestion_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintSuggestion" ADD CONSTRAINT "MaintSuggestion_workOrderId_workspaceId_fkey" FOREIGN KEY ("workOrderId", "workspaceId") REFERENCES "MaintWorkOrder"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;
