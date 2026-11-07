-- CreateEnum
CREATE TYPE "CaePermitType" AS ENUM ('HOT_WORK', 'HEIGHT', 'CONFINED_SPACE', 'ELECTRICAL', 'OTHER');

-- CreateEnum
CREATE TYPE "CaePermitStatus" AS ENUM ('DRAFT', 'ACTIVE', 'CLOSED', 'CANCELLED');

-- CreateTable
CREATE TABLE "CaeInfoDelivery" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "deliveredKeys" TEXT[],
    "deliveredOn" DATE NOT NULL,
    "receivedBy" TEXT NOT NULL,
    "signature" BYTEA,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaeInfoDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaeWorkPermit" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "type" "CaePermitType" NOT NULL,
    "customName" TEXT,
    "companyId" TEXT,
    "location" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3) NOT NULL,
    "workerIds" TEXT[],
    "membershipIds" TEXT[],
    "precautions" JSONB NOT NULL,
    "status" "CaePermitStatus" NOT NULL DEFAULT 'DRAFT',
    "issuedById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvalSignature" BYTEA,
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "closeNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CaeWorkPermit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CaeInfoDelivery_workspaceId_companyId_deliveredOn_idx" ON "CaeInfoDelivery"("workspaceId", "companyId", "deliveredOn");

-- CreateIndex
CREATE UNIQUE INDEX "CaeInfoDelivery_id_workspaceId_key" ON "CaeInfoDelivery"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "CaeWorkPermit_workspaceId_validFrom_id_idx" ON "CaeWorkPermit"("workspaceId", "validFrom", "id");

-- CreateIndex
CREATE INDEX "CaeWorkPermit_workspaceId_status_validTo_idx" ON "CaeWorkPermit"("workspaceId", "status", "validTo");

-- CreateIndex
CREATE INDEX "CaeWorkPermit_workspaceId_companyId_validFrom_idx" ON "CaeWorkPermit"("workspaceId", "companyId", "validFrom");

-- CreateIndex
CREATE UNIQUE INDEX "CaeWorkPermit_id_workspaceId_key" ON "CaeWorkPermit"("id", "workspaceId");

-- AddForeignKey
ALTER TABLE "CaeInfoDelivery" ADD CONSTRAINT "CaeInfoDelivery_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaeInfoDelivery" ADD CONSTRAINT "CaeInfoDelivery_companyId_workspaceId_fkey" FOREIGN KEY ("companyId", "workspaceId") REFERENCES "CaeCompany"("id", "workspaceId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaeWorkPermit" ADD CONSTRAINT "CaeWorkPermit_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaeWorkPermit" ADD CONSTRAINT "CaeWorkPermit_companyId_workspaceId_fkey" FOREIGN KEY ("companyId", "workspaceId") REFERENCES "CaeCompany"("id", "workspaceId") ON DELETE NO ACTION ON UPDATE NO ACTION;
