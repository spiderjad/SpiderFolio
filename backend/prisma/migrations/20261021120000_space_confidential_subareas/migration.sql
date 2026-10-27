-- AlterTable
ALTER TABLE "Space" ADD COLUMN     "includeSubareas" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isConfidential" BOOLEAN NOT NULL DEFAULT false;

-- Confidencial implica privado.
ALTER TABLE "Space" ADD CONSTRAINT "Space_confidential_is_private" CHECK (NOT "isConfidential" OR "isPrivate");
