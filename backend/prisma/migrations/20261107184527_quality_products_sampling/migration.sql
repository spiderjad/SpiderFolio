-- CreateEnum
CREATE TYPE "QualityAllergen" AS ENUM ('GLUTEN', 'CRUSTACEANS', 'EGGS', 'FISH', 'PEANUTS', 'SOY', 'MILK', 'NUTS', 'CELERY', 'MUSTARD', 'SESAME', 'SULPHITES', 'LUPIN', 'MOLLUSCS');

-- CreateEnum
CREATE TYPE "QualityStudyResult" AS ENUM ('PENDING', 'PASSED', 'FAILED');

-- CreateEnum
CREATE TYPE "QualityLabelStatus" AS ENUM ('IN_REVIEW', 'APPROVED', 'REJECTED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "QualitySamplingKind" AS ENUM ('PRODUCT', 'SURFACE', 'ENVIRONMENT', 'WATER');

-- AlterEnum
ALTER TYPE "QualityNcOrigin" ADD VALUE 'LAB';

-- CreateTable
CREATE TABLE "QualityProduct" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "family" TEXT,
    "ingredients" TEXT NOT NULL,
    "allergens" "QualityAllergen"[],
    "mayContain" "QualityAllergen"[],
    "nutrition" JSONB,
    "shelfLifeDays" INTEGER,
    "storage" TEXT,
    "readyToEat" BOOLEAN NOT NULL DEFAULT false,
    "specNodeId" TEXT,
    "folderId" TEXT,
    "notes" TEXT,
    "specVersion" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QualityProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualityShelfLifeStudy" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "startedOn" DATE NOT NULL,
    "targetDays" INTEGER NOT NULL,
    "listeria" BOOLEAN NOT NULL DEFAULT false,
    "result" "QualityStudyResult" NOT NULL DEFAULT 'PENDING',
    "resultOn" DATE,
    "conclusion" TEXT,
    "reportNodeId" TEXT,
    "ncId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QualityShelfLifeStudy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualityLabel" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "nodeId" TEXT,
    "status" "QualityLabelStatus" NOT NULL DEFAULT 'IN_REVIEW',
    "specVersion" INTEGER NOT NULL,
    "checks" JSONB,
    "note" TEXT,
    "submittedById" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,

    CONSTRAINT "QualityLabel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualitySamplingPoint" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" "QualitySamplingKind" NOT NULL,
    "name" TEXT NOT NULL,
    "productId" TEXT,
    "zone" TEXT,
    "parameter" TEXT NOT NULL,
    "criterion" TEXT,
    "maxValue" DOUBLE PRECISION,
    "unit" TEXT,
    "everyDays" INTEGER NOT NULL,
    "laboratory" TEXT,
    "responsibleId" TEXT,
    "lastSampledOn" DATE,
    "nextDueOn" DATE NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QualitySamplingPoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualityLabResult" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "pointId" TEXT NOT NULL,
    "sampledOn" DATE NOT NULL,
    "value" DOUBLE PRECISION,
    "detected" BOOLEAN,
    "conforming" BOOLEAN NOT NULL,
    "reportNodeId" TEXT,
    "note" TEXT,
    "ncId" TEXT,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QualityLabResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QualityProduct_workspaceId_name_idx" ON "QualityProduct"("workspaceId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "QualityProduct_id_workspaceId_key" ON "QualityProduct"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "QualityShelfLifeStudy_workspaceId_productId_startedOn_idx" ON "QualityShelfLifeStudy"("workspaceId", "productId", "startedOn");

-- CreateIndex
CREATE INDEX "QualityLabel_workspaceId_status_idx" ON "QualityLabel"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "QualityLabel_workspaceId_productId_version_key" ON "QualityLabel"("workspaceId", "productId", "version");

-- CreateIndex
CREATE INDEX "QualitySamplingPoint_workspaceId_kind_nextDueOn_idx" ON "QualitySamplingPoint"("workspaceId", "kind", "nextDueOn");

-- CreateIndex
CREATE UNIQUE INDEX "QualitySamplingPoint_id_workspaceId_key" ON "QualitySamplingPoint"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "QualityLabResult_workspaceId_pointId_sampledOn_idx" ON "QualityLabResult"("workspaceId", "pointId", "sampledOn");

-- CreateIndex
CREATE INDEX "QualityLabResult_workspaceId_sampledOn_idx" ON "QualityLabResult"("workspaceId", "sampledOn");

-- AddForeignKey
ALTER TABLE "QualityProduct" ADD CONSTRAINT "QualityProduct_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityShelfLifeStudy" ADD CONSTRAINT "QualityShelfLifeStudy_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityShelfLifeStudy" ADD CONSTRAINT "QualityShelfLifeStudy_productId_workspaceId_fkey" FOREIGN KEY ("productId", "workspaceId") REFERENCES "QualityProduct"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityLabel" ADD CONSTRAINT "QualityLabel_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityLabel" ADD CONSTRAINT "QualityLabel_productId_workspaceId_fkey" FOREIGN KEY ("productId", "workspaceId") REFERENCES "QualityProduct"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualitySamplingPoint" ADD CONSTRAINT "QualitySamplingPoint_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityLabResult" ADD CONSTRAINT "QualityLabResult_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityLabResult" ADD CONSTRAINT "QualityLabResult_pointId_workspaceId_fkey" FOREIGN KEY ("pointId", "workspaceId") REFERENCES "QualitySamplingPoint"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;
