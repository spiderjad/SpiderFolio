-- AlterTable
ALTER TABLE "User" ADD COLUMN     "coverKey" TEXT,
ADD COLUMN     "coverPositionY" INTEGER NOT NULL DEFAULT 50;
