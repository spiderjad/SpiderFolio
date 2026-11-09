-- CreateEnum
CREATE TYPE "EnvPermitKind" AS ENUM ('AAI', 'ENVIRONMENTAL_LICENSE', 'DISCHARGE', 'WASTE_PRODUCER', 'SANDACH_REGISTRY', 'EMISSIONS', 'OTHER');

-- CreateEnum
CREATE TYPE "EnvSandach" AS ENUM ('CAT1', 'CAT2', 'CAT3');

-- CreateEnum
CREATE TYPE "EnvUnit" AS ENUM ('KG', 'T', 'L', 'M3', 'UNITS');

-- AlterEnum
ALTER TYPE "HomeArea" ADD VALUE 'ENVIRONMENT';

-- AlterEnum
ALTER TYPE "SpaceArea" ADD VALUE 'ENVIRONMENT';

-- CreateTable
CREATE TABLE "EnvPermit" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" "EnvPermitKind" NOT NULL,
    "name" TEXT NOT NULL,
    "authority" TEXT NOT NULL DEFAULT '',
    "reference" TEXT NOT NULL DEFAULT '',
    "issuedOn" DATE,
    "expiresOn" DATE,
    "reviewOn" DATE,
    "conditions" TEXT NOT NULL DEFAULT '',
    "ownerId" TEXT,
    "folderId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EnvPermit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnvObligation" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "permitId" TEXT,
    "everyMonths" INTEGER NOT NULL,
    "lastDoneOn" DATE,
    "nextDueOn" DATE NOT NULL,
    "ownerId" TEXT,
    "notes" TEXT NOT NULL DEFAULT '',
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EnvObligation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnvObligationDone" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "obligationId" TEXT NOT NULL,
    "doneOn" DATE NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnvObligationDone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnvContractor" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "nif" TEXT,
    "nima" TEXT,
    "authorizations" TEXT NOT NULL DEFAULT '',
    "isManager" BOOLEAN NOT NULL DEFAULT true,
    "isCarrier" BOOLEAN NOT NULL DEFAULT false,
    "authorizationExpiresOn" DATE,
    "contact" TEXT NOT NULL DEFAULT '',
    "folderId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EnvContractor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnvWaste" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "ler" TEXT NOT NULL,
    "hazardous" BOOLEAN NOT NULL,
    "sandach" "EnvSandach",
    "operation" TEXT NOT NULL DEFAULT '',
    "managerId" TEXT,
    "carrierId" TEXT,
    "contractRef" TEXT NOT NULL DEFAULT '',
    "maxStorageMonths" INTEGER NOT NULL,
    "storageSince" DATE,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EnvWaste_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnvWasteMovement" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "wasteId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unit" "EnvUnit" NOT NULL,
    "managerId" TEXT,
    "carrierId" TEXT,
    "documentRef" TEXT NOT NULL DEFAULT '',
    "vehicle" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnvWasteMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EnvPermit_workspaceId_archivedAt_name_idx" ON "EnvPermit"("workspaceId", "archivedAt", "name");

-- CreateIndex
CREATE UNIQUE INDEX "EnvPermit_id_workspaceId_key" ON "EnvPermit"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "EnvObligation_workspaceId_archivedAt_nextDueOn_idx" ON "EnvObligation"("workspaceId", "archivedAt", "nextDueOn");

-- CreateIndex
CREATE UNIQUE INDEX "EnvObligation_id_workspaceId_key" ON "EnvObligation"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "EnvObligationDone_workspaceId_obligationId_doneOn_idx" ON "EnvObligationDone"("workspaceId", "obligationId", "doneOn");

-- CreateIndex
CREATE UNIQUE INDEX "EnvContractor_id_workspaceId_key" ON "EnvContractor"("id", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "EnvContractor_workspaceId_nameKey_key" ON "EnvContractor"("workspaceId", "nameKey");

-- CreateIndex
CREATE UNIQUE INDEX "EnvWaste_id_workspaceId_key" ON "EnvWaste"("id", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "EnvWaste_workspaceId_nameKey_key" ON "EnvWaste"("workspaceId", "nameKey");

-- CreateIndex
CREATE INDEX "EnvWasteMovement_workspaceId_date_id_idx" ON "EnvWasteMovement"("workspaceId", "date", "id");

-- CreateIndex
CREATE INDEX "EnvWasteMovement_workspaceId_wasteId_date_idx" ON "EnvWasteMovement"("workspaceId", "wasteId", "date");

-- AddForeignKey
ALTER TABLE "EnvPermit" ADD CONSTRAINT "EnvPermit_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnvObligation" ADD CONSTRAINT "EnvObligation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnvObligationDone" ADD CONSTRAINT "EnvObligationDone_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnvObligationDone" ADD CONSTRAINT "EnvObligationDone_obligationId_workspaceId_fkey" FOREIGN KEY ("obligationId", "workspaceId") REFERENCES "EnvObligation"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnvContractor" ADD CONSTRAINT "EnvContractor_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnvWaste" ADD CONSTRAINT "EnvWaste_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnvWasteMovement" ADD CONSTRAINT "EnvWasteMovement_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnvWasteMovement" ADD CONSTRAINT "EnvWasteMovement_wasteId_workspaceId_fkey" FOREIGN KEY ("wasteId", "workspaceId") REFERENCES "EnvWaste"("id", "workspaceId") ON DELETE RESTRICT ON UPDATE CASCADE;
