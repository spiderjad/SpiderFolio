-- Cargo en la pertenencia (HEAD, DEPUTY, MEMBER) en lugar de Department.managerId.
-- Los jefes actuales se conservan: pasan a ser HEAD (y miembros del departamento si no lo eran).

-- CreateEnum
CREATE TYPE "DepartmentPosition" AS ENUM ('HEAD', 'DEPUTY', 'MEMBER');

-- AlterTable
ALTER TABLE "DepartmentMember" ADD COLUMN "position" "DepartmentPosition" NOT NULL DEFAULT 'MEMBER';

-- Datos: el responsable actual entra a la pertenencia (si no estaba) como HEAD.
INSERT INTO "DepartmentMember" ("departmentId", "membershipId", "workspaceId", "position")
SELECT "id", "managerId", "workspaceId", 'HEAD'
FROM "Department"
WHERE "managerId" IS NOT NULL
ON CONFLICT ("departmentId", "membershipId") DO UPDATE SET "position" = 'HEAD';

-- Un solo jefe por departamento (Prisma no expresa índices únicos parciales).
CREATE UNIQUE INDEX "DepartmentMember_one_head_idx" ON "DepartmentMember"("departmentId") WHERE "position" = 'HEAD';

-- DropForeignKey
ALTER TABLE "Department" DROP CONSTRAINT "Department_managerId_workspaceId_fkey";

-- DropIndex
DROP INDEX "Department_managerId_idx";

-- AlterTable
ALTER TABLE "Department" DROP COLUMN "managerId";
