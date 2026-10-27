-- AlterEnum
ALTER TYPE "DocStatus" ADD VALUE 'REJECTED';

-- AlterTable
ALTER TABLE "Approval" ADD COLUMN     "snapshot" JSONB,
ADD COLUMN     "submittedById" TEXT;

-- Lo que hasta ahora se llamaba "rechazo" devolvía el documento a borrador: es «pedir cambios».
UPDATE "Approval" SET "decision" = 'CHANGES_REQUESTED' WHERE "decision" = 'REJECTED';
