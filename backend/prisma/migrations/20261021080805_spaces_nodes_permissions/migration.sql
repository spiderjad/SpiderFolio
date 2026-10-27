-- CreateEnum
CREATE TYPE "AccessLevel" AS ENUM ('MANAGE', 'EDIT', 'COMMENT', 'VIEW');

-- CreateEnum
CREATE TYPE "NodeType" AS ENUM ('FOLDER', 'FILE', 'PAGE');

-- CreateTable
CREATE TABLE "Space" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "icon" TEXT,
    "description" TEXT,
    "isPrivate" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "Space_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Node" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "parentId" TEXT,
    "type" "NodeType" NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "icon" TEXT,
    "position" TEXT NOT NULL,
    "inheritAccess" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "trashedAt" TIMESTAMP(3),
    "trashRootId" TEXT,

    CONSTRAINT "Node_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "spaceId" TEXT,
    "nodeId" TEXT,
    "membershipId" TEXT,
    "departmentId" TEXT,
    "level" "AccessLevel" NOT NULL,
    "grantedById" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Space_workspaceId_archivedAt_idx" ON "Space"("workspaceId", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Space_id_workspaceId_key" ON "Space"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "Node_workspaceId_spaceId_parentId_idx" ON "Node"("workspaceId", "spaceId", "parentId");

-- CreateIndex
CREATE INDEX "Node_workspaceId_trashedAt_idx" ON "Node"("workspaceId", "trashedAt");

-- CreateIndex
CREATE INDEX "Node_workspaceId_trashRootId_idx" ON "Node"("workspaceId", "trashRootId");

-- CreateIndex
CREATE UNIQUE INDEX "Node_id_workspaceId_key" ON "Node"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "Permission_workspaceId_spaceId_idx" ON "Permission"("workspaceId", "spaceId");

-- CreateIndex
CREATE INDEX "Permission_workspaceId_nodeId_idx" ON "Permission"("workspaceId", "nodeId");

-- CreateIndex
CREATE INDEX "Permission_workspaceId_membershipId_idx" ON "Permission"("workspaceId", "membershipId");

-- CreateIndex
CREATE INDEX "Permission_workspaceId_departmentId_idx" ON "Permission"("workspaceId", "departmentId");

-- AddForeignKey
ALTER TABLE "Space" ADD CONSTRAINT "Space_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Node" ADD CONSTRAINT "Node_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Node" ADD CONSTRAINT "Node_spaceId_workspaceId_fkey" FOREIGN KEY ("spaceId", "workspaceId") REFERENCES "Space"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Node" ADD CONSTRAINT "Node_parentId_workspaceId_fkey" FOREIGN KEY ("parentId", "workspaceId") REFERENCES "Node"("id", "workspaceId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Permission" ADD CONSTRAINT "Permission_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Permission" ADD CONSTRAINT "Permission_spaceId_workspaceId_fkey" FOREIGN KEY ("spaceId", "workspaceId") REFERENCES "Space"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Permission" ADD CONSTRAINT "Permission_nodeId_workspaceId_fkey" FOREIGN KEY ("nodeId", "workspaceId") REFERENCES "Node"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Permission" ADD CONSTRAINT "Permission_membershipId_workspaceId_fkey" FOREIGN KEY ("membershipId", "workspaceId") REFERENCES "Membership"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Permission" ADD CONSTRAINT "Permission_departmentId_workspaceId_fkey" FOREIGN KEY ("departmentId", "workspaceId") REFERENCES "Department"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- Nombres únicos (comparados por nameKey: NFC y minúsculas), que Prisma no expresa:
-- entre los espacios no archivados de un workspace…
CREATE UNIQUE INDEX "Space_workspaceId_nameKey_active_idx"
  ON "Space"("workspaceId", "nameKey") WHERE "archivedAt" IS NULL;

-- …y entre los hermanos de una carpeta que no están en la papelera.
CREATE UNIQUE INDEX "Node_sibling_nameKey_active_idx"
  ON "Node"("workspaceId", "spaceId", COALESCE("parentId", ''), "nameKey") WHERE "trashedAt" IS NULL;

-- Un permiso es sobre un espacio o un nodo (no ambos) y para una persona o un departamento.
ALTER TABLE "Permission" ADD CONSTRAINT "Permission_target_check"
  CHECK (("spaceId" IS NOT NULL)::int + ("nodeId" IS NOT NULL)::int = 1);
ALTER TABLE "Permission" ADD CONSTRAINT "Permission_subject_check"
  CHECK (("membershipId" IS NOT NULL)::int + ("departmentId" IS NOT NULL)::int = 1);

-- Un solo permiso por sujeto y objetivo (se actualiza el nivel en lugar de duplicar).
CREATE UNIQUE INDEX "Permission_space_membership_idx"
  ON "Permission"("spaceId", "membershipId") WHERE "spaceId" IS NOT NULL AND "membershipId" IS NOT NULL;
CREATE UNIQUE INDEX "Permission_space_department_idx"
  ON "Permission"("spaceId", "departmentId") WHERE "spaceId" IS NOT NULL AND "departmentId" IS NOT NULL;
CREATE UNIQUE INDEX "Permission_node_membership_idx"
  ON "Permission"("nodeId", "membershipId") WHERE "nodeId" IS NOT NULL AND "membershipId" IS NOT NULL;
CREATE UNIQUE INDEX "Permission_node_department_idx"
  ON "Permission"("nodeId", "departmentId") WHERE "nodeId" IS NOT NULL AND "departmentId" IS NOT NULL;
