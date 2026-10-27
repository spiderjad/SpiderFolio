-- Rotación de refresh tokens con margen y tope absoluto por familia (CLAUDE.md, 6 y 7.1).
-- familyCreatedAt se rellena con createdAt en las sesiones existentes (la mejor aproximación
-- disponible al login que originó la familia).
ALTER TABLE "Session" ADD COLUMN "familyCreatedAt" TIMESTAMP(3);
UPDATE "Session" SET "familyCreatedAt" = "createdAt";
ALTER TABLE "Session" ALTER COLUMN "familyCreatedAt" SET NOT NULL;

ALTER TABLE "Session" ADD COLUMN "replacedAt" TIMESTAMP(3);
