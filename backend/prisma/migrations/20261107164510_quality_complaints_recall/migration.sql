-- CreateEnum
CREATE TYPE "QualityComplaintSource" AS ENUM ('CUSTOMER', 'CONSUMER', 'AUTHORITY');

-- CreateEnum
CREATE TYPE "QualityComplaintCategory" AS ENUM ('FOREIGN_BODY', 'ALLERGEN', 'MICROBIOLOGICAL', 'QUALITY', 'LABELLING', 'PACKAGING', 'OTHER');

-- CreateEnum
CREATE TYPE "QualityComplaintStatus" AS ENUM ('OPEN', 'ANSWERED', 'CLOSED');

-- CreateEnum
CREATE TYPE "QualityCrisisContactKind" AS ENUM ('AUTHORITY', 'CUSTOMER', 'INSURER', 'LAB', 'SUPPLIER', 'OTHER');

-- CreateEnum
CREATE TYPE "QualityRecallKind" AS ENUM ('DRILL', 'REAL');

-- CreateEnum
CREATE TYPE "QualityTraceDirection" AS ENUM ('BACKWARD', 'FORWARD', 'BOTH');

-- CreateTable
CREATE TABLE "QualityComplaint" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "source" "QualityComplaintSource" NOT NULL,
    "from" TEXT NOT NULL,
    "contact" TEXT,
    "product" TEXT NOT NULL,
    "lot" TEXT,
    "category" "QualityComplaintCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "receivedOn" DATE NOT NULL,
    "respondBy" DATE NOT NULL,
    "respondedOn" DATE,
    "response" TEXT,
    "justified" BOOLEAN,
    "status" "QualityComplaintStatus" NOT NULL DEFAULT 'OPEN',
    "ownerId" TEXT NOT NULL,
    "ncId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QualityComplaint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualityMonthUnits" (
    "workspaceId" TEXT NOT NULL,
    "month" DATE NOT NULL,
    "units" INTEGER NOT NULL,

    CONSTRAINT "QualityMonthUnits_pkey" PRIMARY KEY ("workspaceId","month")
);

-- CreateTable
CREATE TABLE "QualityCrisisMember" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "QualityCrisisMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualityCrisisContact" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" "QualityCrisisContactKind" NOT NULL,
    "name" TEXT NOT NULL,
    "organization" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "notes" TEXT,
    "position" INTEGER NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "QualityCrisisContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualityRecallTest" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" "QualityRecallKind" NOT NULL,
    "date" DATE NOT NULL,
    "product" TEXT NOT NULL,
    "lot" TEXT NOT NULL,
    "direction" "QualityTraceDirection" NOT NULL,
    "minutes" INTEGER NOT NULL,
    "recoveredPercent" INTEGER,
    "result" TEXT NOT NULL,
    "ncId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QualityRecallTest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QualityComplaint_workspaceId_receivedOn_id_idx" ON "QualityComplaint"("workspaceId", "receivedOn", "id");

-- CreateIndex
CREATE INDEX "QualityComplaint_workspaceId_status_respondBy_idx" ON "QualityComplaint"("workspaceId", "status", "respondBy");

-- CreateIndex
CREATE UNIQUE INDEX "QualityCrisisMember_workspaceId_membershipId_key" ON "QualityCrisisMember"("workspaceId", "membershipId");

-- CreateIndex
CREATE INDEX "QualityCrisisContact_workspaceId_position_idx" ON "QualityCrisisContact"("workspaceId", "position");

-- CreateIndex
CREATE INDEX "QualityRecallTest_workspaceId_date_id_idx" ON "QualityRecallTest"("workspaceId", "date", "id");

-- AddForeignKey
ALTER TABLE "QualityComplaint" ADD CONSTRAINT "QualityComplaint_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityMonthUnits" ADD CONSTRAINT "QualityMonthUnits_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityCrisisMember" ADD CONSTRAINT "QualityCrisisMember_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityCrisisContact" ADD CONSTRAINT "QualityCrisisContact_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityRecallTest" ADD CONSTRAINT "QualityRecallTest_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
