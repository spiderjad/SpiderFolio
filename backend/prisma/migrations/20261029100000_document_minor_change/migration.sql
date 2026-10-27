-- AlterTable
ALTER TABLE "DocumentVersion" ADD COLUMN     "changeReason" TEXT,
ADD COLUMN     "minorChange" BOOLEAN NOT NULL DEFAULT false;
