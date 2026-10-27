-- Valoraciones de las respuestas de Bian: solo valoración, fecha e ids de los documentos citados.

-- CreateTable
CREATE TABLE "BianFeedback" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "rating" TEXT NOT NULL,
    "nodeIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BianFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BianFeedback_workspaceId_createdAt_idx" ON "BianFeedback"("workspaceId", "createdAt");

-- AddForeignKey
ALTER TABLE "BianFeedback" ADD CONSTRAINT "BianFeedback_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
