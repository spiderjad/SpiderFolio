-- CreateEnum
CREATE TYPE "WhistleblowingStatus" AS ENUM ('RECEIVED', 'ADMITTED', 'NOT_ADMITTED', 'INVESTIGATING', 'CLOSED');

-- CreateEnum
CREATE TYPE "WhistleblowingOutcome" AS ENUM ('SUBSTANTIATED', 'NOT_SUBSTANTIATED', 'PARTIAL', 'REFERRED');

-- CreateEnum
CREATE TYPE "WhistleblowingParty" AS ENUM ('REPORTER', 'MANAGEMENT');

-- AlterEnum
ALTER TYPE "HomeArea" ADD VALUE 'CHANNEL';

-- CreateTable
CREATE TABLE "WhistleblowingManager" (
    "workspaceId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "responsible" BOOLEAN NOT NULL DEFAULT false,
    "addedById" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhistleblowingManager_pkey" PRIMARY KEY ("workspaceId","membershipId")
);

-- CreateTable
CREATE TABLE "WhistleblowingCounter" (
    "workspaceId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "last" INTEGER NOT NULL,

    CONSTRAINT "WhistleblowingCounter_pkey" PRIMARY KEY ("workspaceId","year")
);

-- CreateTable
CREATE TABLE "WhistleblowingCase" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "number" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "status" "WhistleblowingStatus" NOT NULL DEFAULT 'RECEIVED',
    "outcome" "WhistleblowingOutcome",
    "anonymous" BOOLEAN NOT NULL,
    "bodyEnc" TEXT,
    "codeHash" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "failedLogins" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "decisionEnc" TEXT,
    "dueOn" DATE NOT NULL,
    "extendedAt" TIMESTAMP(3),
    "extensionEnc" TEXT,
    "referredAt" TIMESTAMP(3),
    "affectedInformedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "instructorId" TEXT,
    "unread" BOOLEAN NOT NULL DEFAULT true,
    "purgeAfter" TIMESTAMP(3),
    "purgedAt" TIMESTAMP(3),

    CONSTRAINT "WhistleblowingCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhistleblowingExclusion" (
    "workspaceId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,

    CONSTRAINT "WhistleblowingExclusion_pkey" PRIMARY KEY ("caseId","membershipId")
);

-- CreateTable
CREATE TABLE "WhistleblowingMessage" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "from" "WhistleblowingParty" NOT NULL,
    "bodyEnc" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhistleblowingMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhistleblowingNote" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "bodyEnc" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhistleblowingNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhistleblowingEvent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "membershipId" TEXT,
    "action" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhistleblowingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhistleblowingSession" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhistleblowingSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhistleblowingCase_codeHash_key" ON "WhistleblowingCase"("codeHash");

-- CreateIndex
CREATE INDEX "WhistleblowingCase_workspaceId_receivedAt_id_idx" ON "WhistleblowingCase"("workspaceId", "receivedAt", "id");

-- CreateIndex
CREATE INDEX "WhistleblowingCase_workspaceId_status_idx" ON "WhistleblowingCase"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "WhistleblowingCase_id_workspaceId_key" ON "WhistleblowingCase"("id", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "WhistleblowingCase_workspaceId_year_number_key" ON "WhistleblowingCase"("workspaceId", "year", "number");

-- CreateIndex
CREATE INDEX "WhistleblowingExclusion_workspaceId_membershipId_idx" ON "WhistleblowingExclusion"("workspaceId", "membershipId");

-- CreateIndex
CREATE INDEX "WhistleblowingMessage_workspaceId_caseId_createdAt_idx" ON "WhistleblowingMessage"("workspaceId", "caseId", "createdAt");

-- CreateIndex
CREATE INDEX "WhistleblowingNote_workspaceId_caseId_createdAt_idx" ON "WhistleblowingNote"("workspaceId", "caseId", "createdAt");

-- CreateIndex
CREATE INDEX "WhistleblowingEvent_workspaceId_caseId_createdAt_idx" ON "WhistleblowingEvent"("workspaceId", "caseId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WhistleblowingSession_tokenHash_key" ON "WhistleblowingSession"("tokenHash");

-- CreateIndex
CREATE INDEX "WhistleblowingSession_workspaceId_caseId_idx" ON "WhistleblowingSession"("workspaceId", "caseId");

-- AddForeignKey
ALTER TABLE "WhistleblowingManager" ADD CONSTRAINT "WhistleblowingManager_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhistleblowingCounter" ADD CONSTRAINT "WhistleblowingCounter_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhistleblowingCase" ADD CONSTRAINT "WhistleblowingCase_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhistleblowingExclusion" ADD CONSTRAINT "WhistleblowingExclusion_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhistleblowingExclusion" ADD CONSTRAINT "WhistleblowingExclusion_caseId_workspaceId_fkey" FOREIGN KEY ("caseId", "workspaceId") REFERENCES "WhistleblowingCase"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhistleblowingMessage" ADD CONSTRAINT "WhistleblowingMessage_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhistleblowingMessage" ADD CONSTRAINT "WhistleblowingMessage_caseId_workspaceId_fkey" FOREIGN KEY ("caseId", "workspaceId") REFERENCES "WhistleblowingCase"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhistleblowingNote" ADD CONSTRAINT "WhistleblowingNote_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhistleblowingNote" ADD CONSTRAINT "WhistleblowingNote_caseId_workspaceId_fkey" FOREIGN KEY ("caseId", "workspaceId") REFERENCES "WhistleblowingCase"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhistleblowingEvent" ADD CONSTRAINT "WhistleblowingEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhistleblowingEvent" ADD CONSTRAINT "WhistleblowingEvent_caseId_workspaceId_fkey" FOREIGN KEY ("caseId", "workspaceId") REFERENCES "WhistleblowingCase"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhistleblowingSession" ADD CONSTRAINT "WhistleblowingSession_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhistleblowingSession" ADD CONSTRAINT "WhistleblowingSession_caseId_workspaceId_fkey" FOREIGN KEY ("caseId", "workspaceId") REFERENCES "WhistleblowingCase"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;
