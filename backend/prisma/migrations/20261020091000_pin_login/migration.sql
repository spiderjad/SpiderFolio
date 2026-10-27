-- CreateEnum
CREATE TYPE "UserKind" AS ENUM ('STANDARD', 'PIN');

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "idleSeconds" INTEGER;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "kind" "UserKind" NOT NULL DEFAULT 'STANDARD',
ALTER COLUMN "email" DROP NOT NULL,
ALTER COLUMN "passwordHash" DROP NOT NULL;

-- CreateTable
CREATE TABLE "PinLogin" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "loginName" TEXT NOT NULL,
    "pinHash" TEXT NOT NULL,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "pinChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pinChangedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PinLogin_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PinLogin_membershipId_key" ON "PinLogin"("membershipId");

-- CreateIndex
CREATE UNIQUE INDEX "PinLogin_workspaceId_loginName_key" ON "PinLogin"("workspaceId", "loginName");

-- CreateIndex
CREATE UNIQUE INDEX "PinLogin_membershipId_workspaceId_key" ON "PinLogin"("membershipId", "workspaceId");

-- AddForeignKey
ALTER TABLE "PinLogin" ADD CONSTRAINT "PinLogin_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PinLogin" ADD CONSTRAINT "PinLogin_membershipId_workspaceId_fkey" FOREIGN KEY ("membershipId", "workspaceId") REFERENCES "Membership"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- Reglas que Prisma no expresa: un usuario de PIN no tiene email ni contraseña (entra solo por
-- PinLogin) y uno estándar tiene ambos; el usuario de PIN es corto y en minúsculas.
ALTER TABLE "User" ADD CONSTRAINT "User_kind_credentials_check" CHECK (
  ("kind" = 'STANDARD' AND "email" IS NOT NULL AND "passwordHash" IS NOT NULL)
  OR ("kind" = 'PIN' AND "email" IS NULL AND "passwordHash" IS NULL)
);
ALTER TABLE "PinLogin" ADD CONSTRAINT "PinLogin_loginName_check" CHECK ("loginName" ~ '^[a-z0-9._-]{3,32}$');
