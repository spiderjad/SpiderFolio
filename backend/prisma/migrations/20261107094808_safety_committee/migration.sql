-- CreateEnum
CREATE TYPE "SafetyCommitteeRole" AS ENUM ('DELEGATE', 'COMPANY_REP', 'ADVISOR', 'SECRETARY');

-- CreateEnum
CREATE TYPE "SafetyMeetingKind" AS ENUM ('ORDINARY', 'EXTRAORDINARY');

-- AlterEnum
ALTER TYPE "SafetyActionOrigin" ADD VALUE 'COMMITTEE';

-- AlterTable
ALTER TABLE "SafetyAction" ADD COLUMN     "meetingId" TEXT;

-- CreateTable
CREATE TABLE "SafetyCommitteeMember" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "role" "SafetyCommitteeRole" NOT NULL,
    "termStart" DATE,
    "termEnd" DATE,
    "endedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SafetyCommitteeMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SafetyMeeting" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "kind" "SafetyMeetingKind" NOT NULL,
    "attendeeIds" TEXT[],
    "agenda" TEXT,
    "minutesNodeId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SafetyMeeting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SafetyCommitteeMember_workspaceId_membershipId_idx" ON "SafetyCommitteeMember"("workspaceId", "membershipId");

-- CreateIndex
CREATE INDEX "SafetyCommitteeMember_workspaceId_endedAt_idx" ON "SafetyCommitteeMember"("workspaceId", "endedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SafetyCommitteeMember_id_workspaceId_key" ON "SafetyCommitteeMember"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "SafetyMeeting_workspaceId_date_id_idx" ON "SafetyMeeting"("workspaceId", "date", "id");

-- CreateIndex
CREATE INDEX "SafetyMeeting_workspaceId_kind_date_idx" ON "SafetyMeeting"("workspaceId", "kind", "date");

-- CreateIndex
CREATE UNIQUE INDEX "SafetyMeeting_id_workspaceId_key" ON "SafetyMeeting"("id", "workspaceId");

-- AddForeignKey
ALTER TABLE "SafetyAction" ADD CONSTRAINT "SafetyAction_meetingId_workspaceId_fkey" FOREIGN KEY ("meetingId", "workspaceId") REFERENCES "SafetyMeeting"("id", "workspaceId") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "SafetyCommitteeMember" ADD CONSTRAINT "SafetyCommitteeMember_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyMeeting" ADD CONSTRAINT "SafetyMeeting_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
