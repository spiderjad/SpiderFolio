-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "detail" TEXT;

-- CreateTable
CREATE TABLE "SystemEmailHealth" (
    "id" TEXT NOT NULL DEFAULT 'system',
    "lastErrorCode" TEXT,
    "lastErrorAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastAlertAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemEmailHealth_pkey" PRIMARY KEY ("id")
);
