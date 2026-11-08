-- CreateEnum
CREATE TYPE "QualityLotKind" AS ENUM ('RAW', 'INTERMEDIATE', 'FINISHED');

-- CreateEnum
CREATE TYPE "QualityTraceSource" AS ENUM ('MANUAL', 'CSV', 'PLUGIN');

-- AlterTable
ALTER TABLE "QualityComplaint" ADD COLUMN     "lotId" TEXT;

-- AlterTable
ALTER TABLE "QualityHold" ADD COLUMN     "lotId" TEXT;

-- AlterTable
ALTER TABLE "QualityRecallTest" ADD COLUMN     "lotId" TEXT;

-- CreateTable
CREATE TABLE "QualityLot" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" "QualityLotKind" NOT NULL,
    "code" TEXT NOT NULL,
    "productId" TEXT,
    "material" TEXT,
    "supplierId" TEXT,
    "supplierLot" TEXT,
    "origin" TEXT,
    "quantity" DECIMAL(14,3),
    "unit" TEXT,
    "date" DATE NOT NULL,
    "expiresOn" DATE,
    "source" "QualityTraceSource" NOT NULL DEFAULT 'MANUAL',
    "sourceId" TEXT,
    "externalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QualityLot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualityLotLink" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "inputId" TEXT NOT NULL,
    "outputId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3),
    "unit" TEXT,
    "source" "QualityTraceSource" NOT NULL DEFAULT 'MANUAL',
    "sourceId" TEXT,
    "externalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QualityLotLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualityShipment" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "customer" TEXT NOT NULL,
    "document" TEXT,
    "shippedOn" DATE NOT NULL,
    "quantity" DECIMAL(14,3),
    "unit" TEXT,
    "source" "QualityTraceSource" NOT NULL DEFAULT 'MANUAL',
    "sourceId" TEXT,
    "externalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QualityShipment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QualityLot_workspaceId_date_id_idx" ON "QualityLot"("workspaceId", "date", "id");

-- CreateIndex
CREATE INDEX "QualityLot_workspaceId_source_sourceId_externalId_idx" ON "QualityLot"("workspaceId", "source", "sourceId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "QualityLot_id_workspaceId_key" ON "QualityLot"("id", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "QualityLot_workspaceId_kind_code_key" ON "QualityLot"("workspaceId", "kind", "code");

-- CreateIndex
CREATE INDEX "QualityLotLink_workspaceId_outputId_idx" ON "QualityLotLink"("workspaceId", "outputId");

-- CreateIndex
CREATE INDEX "QualityLotLink_workspaceId_inputId_idx" ON "QualityLotLink"("workspaceId", "inputId");

-- CreateIndex
CREATE UNIQUE INDEX "QualityLotLink_inputId_outputId_key" ON "QualityLotLink"("inputId", "outputId");

-- CreateIndex
CREATE INDEX "QualityShipment_workspaceId_lotId_idx" ON "QualityShipment"("workspaceId", "lotId");

-- CreateIndex
CREATE INDEX "QualityShipment_workspaceId_shippedOn_id_idx" ON "QualityShipment"("workspaceId", "shippedOn", "id");

-- AddForeignKey
ALTER TABLE "QualityLot" ADD CONSTRAINT "QualityLot_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityLotLink" ADD CONSTRAINT "QualityLotLink_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityLotLink" ADD CONSTRAINT "QualityLotLink_inputId_workspaceId_fkey" FOREIGN KEY ("inputId", "workspaceId") REFERENCES "QualityLot"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityLotLink" ADD CONSTRAINT "QualityLotLink_outputId_workspaceId_fkey" FOREIGN KEY ("outputId", "workspaceId") REFERENCES "QualityLot"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityShipment" ADD CONSTRAINT "QualityShipment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityShipment" ADD CONSTRAINT "QualityShipment_lotId_workspaceId_fkey" FOREIGN KEY ("lotId", "workspaceId") REFERENCES "QualityLot"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;
