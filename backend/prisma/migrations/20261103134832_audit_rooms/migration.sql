-- CreateTable
CREATE TABLE "AuditRoom" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "auditorEmail" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "allowDownload" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "firstAccessAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditRoom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditRoomItem" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "nodeId" TEXT,
    "spaceId" TEXT,
    "report" TEXT,
    "params" JSONB,
    "title" TEXT NOT NULL,
    "addedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditRoomItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditRoomCode" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditRoomCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditRoomSession" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditRoomSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditRoomAccess" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "itemId" TEXT,
    "what" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditRoomAccess_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditRoom_workspaceId_createdAt_idx" ON "AuditRoom"("workspaceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AuditRoom_id_workspaceId_key" ON "AuditRoom"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "AuditRoomItem_workspaceId_roomId_idx" ON "AuditRoomItem"("workspaceId", "roomId");

-- CreateIndex
CREATE INDEX "AuditRoomCode_workspaceId_roomId_idx" ON "AuditRoomCode"("workspaceId", "roomId");

-- CreateIndex
CREATE UNIQUE INDEX "AuditRoomSession_tokenHash_key" ON "AuditRoomSession"("tokenHash");

-- CreateIndex
CREATE INDEX "AuditRoomSession_workspaceId_roomId_idx" ON "AuditRoomSession"("workspaceId", "roomId");

-- CreateIndex
CREATE INDEX "AuditRoomAccess_workspaceId_roomId_createdAt_idx" ON "AuditRoomAccess"("workspaceId", "roomId", "createdAt");

-- AddForeignKey
ALTER TABLE "AuditRoom" ADD CONSTRAINT "AuditRoom_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditRoomItem" ADD CONSTRAINT "AuditRoomItem_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditRoomItem" ADD CONSTRAINT "AuditRoomItem_roomId_workspaceId_fkey" FOREIGN KEY ("roomId", "workspaceId") REFERENCES "AuditRoom"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditRoomCode" ADD CONSTRAINT "AuditRoomCode_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditRoomCode" ADD CONSTRAINT "AuditRoomCode_roomId_workspaceId_fkey" FOREIGN KEY ("roomId", "workspaceId") REFERENCES "AuditRoom"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditRoomSession" ADD CONSTRAINT "AuditRoomSession_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditRoomSession" ADD CONSTRAINT "AuditRoomSession_roomId_workspaceId_fkey" FOREIGN KEY ("roomId", "workspaceId") REFERENCES "AuditRoom"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditRoomAccess" ADD CONSTRAINT "AuditRoomAccess_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditRoomAccess" ADD CONSTRAINT "AuditRoomAccess_roomId_workspaceId_fkey" FOREIGN KEY ("roomId", "workspaceId") REFERENCES "AuditRoom"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

