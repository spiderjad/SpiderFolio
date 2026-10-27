-- AlterTable
ALTER TABLE "Node" ADD COLUMN     "currentVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "mimeType" TEXT,
ADD COLUMN     "sizeBytes" BIGINT;

-- CreateTable
CREATE TABLE "FileVersion" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "checksum" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "purgedAt" TIMESTAMP(3),

    CONSTRAINT "FileVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UploadReservation" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "bytes" BIGINT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "parentId" TEXT,
    "nodeId" TEXT NOT NULL,
    "isNewNode" BOOLEAN NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "conflict" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "multipartId" TEXT,
    "partSize" INTEGER,

    CONSTRAINT "UploadReservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FileVersion_storageKey_key" ON "FileVersion"("storageKey");

-- CreateIndex
CREATE INDEX "FileVersion_workspaceId_purgedAt_idx" ON "FileVersion"("workspaceId", "purgedAt");

-- CreateIndex
CREATE INDEX "FileVersion_workspaceId_checksum_idx" ON "FileVersion"("workspaceId", "checksum");

-- CreateIndex
CREATE UNIQUE INDEX "FileVersion_nodeId_version_key" ON "FileVersion"("nodeId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "UploadReservation_storageKey_key" ON "UploadReservation"("storageKey");

-- CreateIndex
CREATE INDEX "UploadReservation_workspaceId_expiresAt_idx" ON "UploadReservation"("workspaceId", "expiresAt");

-- CreateIndex
CREATE INDEX "UploadReservation_expiresAt_idx" ON "UploadReservation"("expiresAt");

-- AddForeignKey
ALTER TABLE "FileVersion" ADD CONSTRAINT "FileVersion_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileVersion" ADD CONSTRAINT "FileVersion_nodeId_workspaceId_fkey" FOREIGN KEY ("nodeId", "workspaceId") REFERENCES "Node"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadReservation" ADD CONSTRAINT "UploadReservation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
