-- AlterTable
ALTER TABLE "Node" ADD COLUMN     "updatedVia" TEXT,
ADD COLUMN     "updatedViaAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "PageContent" ADD COLUMN     "updatedVia" TEXT,
ADD COLUMN     "updatedViaAt" TIMESTAMP(3);
