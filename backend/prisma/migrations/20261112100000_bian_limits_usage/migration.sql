-- Límites y reparto de consultas de Bian: contador por persona, límites (general, por departamento y por
-- persona) y consultas extra que suman al total de la empresa. Aditiva.

-- CreateEnum
CREATE TYPE "BianLimitScope" AS ENUM ('GENERAL', 'DEPARTMENT', 'PERSON');

-- CreateEnum
CREATE TYPE "BianLimitMode" AS ENUM ('LIMIT', 'UNLIMITED', 'BLOCKED');

-- CreateTable
CREATE TABLE "UsageCounterMember" (
    "workspaceId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "aiQueries" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "UsageCounterMember_pkey" PRIMARY KEY ("membershipId","periodStart")
);

-- CreateTable
CREATE TABLE "BianLimit" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "scope" "BianLimitScope" NOT NULL,
    "departmentId" TEXT,
    "membershipId" TEXT,
    "mode" "BianLimitMode" NOT NULL,
    "limit" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BianLimit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiQueryBonus" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "note" TEXT,
    "periodStart" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiQueryBonus_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UsageCounterMember_workspaceId_periodStart_idx" ON "UsageCounterMember"("workspaceId", "periodStart");

-- CreateIndex
CREATE INDEX "BianLimit_workspaceId_scope_idx" ON "BianLimit"("workspaceId", "scope");

-- CreateIndex
CREATE INDEX "AiQueryBonus_workspaceId_periodStart_idx" ON "AiQueryBonus"("workspaceId", "periodStart");

-- AddForeignKey
ALTER TABLE "UsageCounterMember" ADD CONSTRAINT "UsageCounterMember_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BianLimit" ADD CONSTRAINT "BianLimit_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiQueryBonus" ADD CONSTRAINT "AiQueryBonus_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Un solo límite por sujeto (general, departamento o persona) y coherencia de cada fila.
CREATE UNIQUE INDEX "BianLimit_general_key" ON "BianLimit"("workspaceId") WHERE "scope" = 'GENERAL';
CREATE UNIQUE INDEX "BianLimit_department_key" ON "BianLimit"("workspaceId", "departmentId") WHERE "scope" = 'DEPARTMENT';
CREATE UNIQUE INDEX "BianLimit_person_key" ON "BianLimit"("workspaceId", "membershipId") WHERE "scope" = 'PERSON';
ALTER TABLE "BianLimit" ADD CONSTRAINT "BianLimit_subject_check" CHECK (
  ("scope" = 'GENERAL' AND "departmentId" IS NULL AND "membershipId" IS NULL AND "mode" <> 'BLOCKED')
  OR ("scope" = 'DEPARTMENT' AND "departmentId" IS NOT NULL AND "membershipId" IS NULL AND "mode" <> 'BLOCKED')
  OR ("scope" = 'PERSON' AND "membershipId" IS NOT NULL AND "departmentId" IS NULL)
);
ALTER TABLE "BianLimit" ADD CONSTRAINT "BianLimit_limit_check" CHECK (
  ("mode" = 'LIMIT' AND "limit" IS NOT NULL AND "limit" >= 0) OR ("mode" <> 'LIMIT' AND "limit" IS NULL)
);
ALTER TABLE "AiQueryBonus" ADD CONSTRAINT "AiQueryBonus_amount_check" CHECK ("amount" > 0);
