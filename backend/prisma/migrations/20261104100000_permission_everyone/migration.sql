-- AlterTable: acceso a toda la empresa (todos los miembros activos, sin invitados externos).
ALTER TABLE "Permission" ADD COLUMN "everyone" BOOLEAN NOT NULL DEFAULT false;

-- Un permiso es para una persona, un departamento o toda la empresa (uno solo).
ALTER TABLE "Permission" DROP CONSTRAINT "Permission_subject_check";
ALTER TABLE "Permission" ADD CONSTRAINT "Permission_subject_check"
  CHECK (("membershipId" IS NOT NULL)::int + ("departmentId" IS NOT NULL)::int + "everyone"::int = 1);

-- Uno solo por espacio o nodo (se actualiza el nivel en lugar de duplicar).
CREATE UNIQUE INDEX "Permission_space_everyone_key" ON "Permission"("spaceId") WHERE "spaceId" IS NOT NULL AND "everyone";
CREATE UNIQUE INDEX "Permission_node_everyone_key" ON "Permission"("nodeId") WHERE "nodeId" IS NOT NULL AND "everyone";
