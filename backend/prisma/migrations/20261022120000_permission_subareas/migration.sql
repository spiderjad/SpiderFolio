-- Un acceso dado a un departamento puede incluir o no a sus subdepartamentos (como los espacios).
-- Hasta ahora siempre los incluía: los accesos que ya existen conservan ese comportamiento.
ALTER TABLE "Permission" ADD COLUMN "includeSubareas" BOOLEAN NOT NULL DEFAULT false;
UPDATE "Permission" SET "includeSubareas" = true WHERE "departmentId" IS NOT NULL;
