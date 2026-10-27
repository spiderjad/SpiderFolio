-- Pedidos de una empresa al equipo de SpiderFolio (comprar más consultas de Bian, cambiar de plan)
-- mientras no haya cobro con Stripe. Aditiva.

-- CreateTable
CREATE TABLE "StaffRequest" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "targetPlan" TEXT,
    "message" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "handledAt" TIMESTAMP(3),
    "handledById" TEXT,

    CONSTRAINT "StaffRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StaffRequest_workspaceId_status_idx" ON "StaffRequest"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "StaffRequest_status_createdAt_idx" ON "StaffRequest"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "StaffRequest" ADD CONSTRAINT "StaffRequest_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
