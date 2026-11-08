-- AlterTable
ALTER TABLE "ControlledDocument" ADD COLUMN     "externalRef" TEXT,
ADD COLUMN     "issuer" TEXT;

-- AlterTable
ALTER TABLE "DocumentType" ADD COLUMN     "external" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "DocumentVersion" ADD COLUMN     "edition" TEXT;
