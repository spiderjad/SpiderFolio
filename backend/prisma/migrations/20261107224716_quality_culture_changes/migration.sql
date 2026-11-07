-- CreateEnum
CREATE TYPE "QualityCultureKind" AS ENUM ('TRAINING', 'COMMUNICATION', 'SURVEY', 'MEETING', 'OTHER');

-- CreateEnum
CREATE TYPE "QualityChangeKind" AS ENUM ('RECIPE', 'PRODUCT', 'LINE', 'EQUIPMENT', 'SUPPLIER', 'PROCESS', 'OTHER');

-- CreateEnum
CREATE TYPE "QualityChangeStatus" AS ENUM ('PROPOSED', 'APPROVED', 'REJECTED', 'IMPLEMENTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "QualityChangeImpact" AS ENUM ('NONE', 'LOW', 'HIGH');

-- CreateTable
CREATE TABLE "QualityCulturePlan" (
    "workspaceId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "objectives" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QualityCulturePlan_pkey" PRIMARY KEY ("workspaceId","year")
);

-- CreateTable
CREATE TABLE "QualityCultureActivity" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "kind" "QualityCultureKind" NOT NULL,
    "plannedOn" DATE NOT NULL,
    "doneOn" DATE,
    "responsibleId" TEXT,
    "note" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QualityCultureActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualityCultureSurvey" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "questions" TEXT[],
    "opensOn" DATE NOT NULL,
    "closesOn" DATE NOT NULL,
    "closedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QualityCultureSurvey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualityCultureAnswer" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "surveyId" TEXT NOT NULL,
    "scores" INTEGER[],
    "comment" TEXT,

    CONSTRAINT "QualityCultureAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualityCultureVoter" (
    "workspaceId" TEXT NOT NULL,
    "surveyId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,

    CONSTRAINT "QualityCultureVoter_pkey" PRIMARY KEY ("surveyId","membershipId")
);

-- CreateTable
CREATE TABLE "QualityChange" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "kind" "QualityChangeKind" NOT NULL,
    "description" TEXT NOT NULL,
    "productId" TEXT,
    "plannedOn" DATE,
    "status" "QualityChangeStatus" NOT NULL DEFAULT 'PROPOSED',
    "review" JSONB NOT NULL,
    "impact" "QualityChangeImpact",
    "ownerId" TEXT,
    "proposedById" TEXT NOT NULL,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "implementedOn" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QualityChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualityChangeCounter" (
    "workspaceId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "last" INTEGER NOT NULL,

    CONSTRAINT "QualityChangeCounter_pkey" PRIMARY KEY ("workspaceId","year")
);

-- CreateIndex
CREATE INDEX "QualityCultureActivity_workspaceId_year_plannedOn_idx" ON "QualityCultureActivity"("workspaceId", "year", "plannedOn");

-- CreateIndex
CREATE INDEX "QualityCultureSurvey_workspaceId_opensOn_idx" ON "QualityCultureSurvey"("workspaceId", "opensOn");

-- CreateIndex
CREATE UNIQUE INDEX "QualityCultureSurvey_id_workspaceId_key" ON "QualityCultureSurvey"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "QualityCultureAnswer_workspaceId_surveyId_idx" ON "QualityCultureAnswer"("workspaceId", "surveyId");

-- CreateIndex
CREATE INDEX "QualityCultureVoter_workspaceId_membershipId_idx" ON "QualityCultureVoter"("workspaceId", "membershipId");

-- CreateIndex
CREATE INDEX "QualityChange_workspaceId_createdAt_id_idx" ON "QualityChange"("workspaceId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "QualityChange_workspaceId_status_idx" ON "QualityChange"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "QualityChange_workspaceId_year_number_key" ON "QualityChange"("workspaceId", "year", "number");

-- AddForeignKey
ALTER TABLE "QualityCulturePlan" ADD CONSTRAINT "QualityCulturePlan_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityCultureActivity" ADD CONSTRAINT "QualityCultureActivity_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityCultureSurvey" ADD CONSTRAINT "QualityCultureSurvey_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityCultureAnswer" ADD CONSTRAINT "QualityCultureAnswer_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityCultureAnswer" ADD CONSTRAINT "QualityCultureAnswer_surveyId_workspaceId_fkey" FOREIGN KEY ("surveyId", "workspaceId") REFERENCES "QualityCultureSurvey"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityCultureVoter" ADD CONSTRAINT "QualityCultureVoter_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityCultureVoter" ADD CONSTRAINT "QualityCultureVoter_surveyId_workspaceId_fkey" FOREIGN KEY ("surveyId", "workspaceId") REFERENCES "QualityCultureSurvey"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityChange" ADD CONSTRAINT "QualityChange_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityChangeCounter" ADD CONSTRAINT "QualityChangeCounter_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
