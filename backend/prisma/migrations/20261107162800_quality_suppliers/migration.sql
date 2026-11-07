-- CreateEnum
CREATE TYPE "QualitySupplierCategory" AS ENUM ('RAW_MATERIAL', 'INGREDIENT', 'PACKAGING', 'SERVICE', 'OTHER');

-- CreateEnum
CREATE TYPE "QualityRisk" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "QualitySupplierStatus" AS ENUM ('PENDING', 'APPROVED', 'CONDITIONAL', 'BLOCKED');

-- CreateEnum
CREATE TYPE "QualitySupplierDocKind" AS ENUM ('CERT_IFS', 'CERT_BRCGS', 'CERT_OTHER', 'SPEC_SHEET', 'QUESTIONNAIRE', 'ANALYSIS', 'OTHER');

-- AlterTable
ALTER TABLE "QualityNc" ADD COLUMN     "supplierId" TEXT;

-- CreateTable
CREATE TABLE "QualitySupplier" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "taxId" TEXT,
    "category" "QualitySupplierCategory" NOT NULL,
    "supplies" TEXT NOT NULL,
    "risk" "QualityRisk" NOT NULL,
    "fraudRisk" "QualityRisk" NOT NULL DEFAULT 'LOW',
    "fraudNote" TEXT,
    "contact" TEXT,
    "ownerId" TEXT,
    "status" "QualitySupplierStatus" NOT NULL DEFAULT 'PENDING',
    "nextReviewOn" DATE,
    "folderId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QualitySupplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualitySupplierDoc" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "kind" "QualitySupplierDocKind" NOT NULL,
    "name" TEXT NOT NULL,
    "nodeId" TEXT,
    "validUntil" DATE,
    "archivedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QualitySupplierDoc_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualitySupplierReview" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "reviewedOn" DATE NOT NULL,
    "scores" JSONB NOT NULL,
    "result" "QualitySupplierStatus" NOT NULL,
    "note" TEXT NOT NULL,
    "reviewedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QualitySupplierReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QualitySupplier_workspaceId_status_idx" ON "QualitySupplier"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "QualitySupplier_id_workspaceId_key" ON "QualitySupplier"("id", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "QualitySupplier_workspaceId_nameKey_key" ON "QualitySupplier"("workspaceId", "nameKey");

-- CreateIndex
CREATE INDEX "QualitySupplierDoc_workspaceId_supplierId_idx" ON "QualitySupplierDoc"("workspaceId", "supplierId");

-- CreateIndex
CREATE INDEX "QualitySupplierReview_workspaceId_supplierId_reviewedOn_idx" ON "QualitySupplierReview"("workspaceId", "supplierId", "reviewedOn");

-- AddForeignKey
ALTER TABLE "QualityNc" ADD CONSTRAINT "QualityNc_supplierId_workspaceId_fkey" FOREIGN KEY ("supplierId", "workspaceId") REFERENCES "QualitySupplier"("id", "workspaceId") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "QualitySupplier" ADD CONSTRAINT "QualitySupplier_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualitySupplierDoc" ADD CONSTRAINT "QualitySupplierDoc_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualitySupplierDoc" ADD CONSTRAINT "QualitySupplierDoc_supplierId_workspaceId_fkey" FOREIGN KEY ("supplierId", "workspaceId") REFERENCES "QualitySupplier"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualitySupplierReview" ADD CONSTRAINT "QualitySupplierReview_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualitySupplierReview" ADD CONSTRAINT "QualitySupplierReview_supplierId_workspaceId_fkey" FOREIGN KEY ("supplierId", "workspaceId") REFERENCES "QualitySupplier"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;
