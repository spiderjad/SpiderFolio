-- Papelera de versiones guardadas: al superar fileVersionsKept del plan, la versión más antigua de un
-- archivo común pasa a la papelera (se oculta del historial) y se elimina a los 30 días. Aditiva.

-- AlterTable
ALTER TABLE "FileVersion" ADD COLUMN "trashedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "FileVersion_workspaceId_trashedAt_idx" ON "FileVersion"("workspaceId", "trashedAt");
