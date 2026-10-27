-- El idioma de la persona pasa a ser opcional: null = el idioma de su empresa.
-- Hasta ahora nadie podía elegirlo (todos tenían "es" por defecto), así que pasan a seguir a la empresa.
ALTER TABLE "User" ALTER COLUMN "locale" DROP NOT NULL,
ALTER COLUMN "locale" DROP DEFAULT;

UPDATE "User" SET "locale" = NULL;
