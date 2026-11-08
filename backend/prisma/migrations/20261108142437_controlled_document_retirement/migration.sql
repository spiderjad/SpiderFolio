-- AlterTable
ALTER TABLE "ControlledDocument" ADD COLUMN     "retireReason" TEXT,
ADD COLUMN     "retiredAt" TIMESTAMP(3),
ADD COLUMN     "retiredById" TEXT,
ADD COLUMN     "retiredVersion" INTEGER;
