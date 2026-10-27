-- Un solo acceso por (espacio o nodo, persona o departamento): hasta ahora solo lo cuidaba el código.
-- Índices únicos parciales (Prisma no los expresa en el esquema, como DepartmentMember_one_head_idx).
CREATE UNIQUE INDEX "Permission_space_membership_key" ON "Permission"("spaceId", "membershipId") WHERE "spaceId" IS NOT NULL AND "membershipId" IS NOT NULL;
CREATE UNIQUE INDEX "Permission_space_department_key" ON "Permission"("spaceId", "departmentId") WHERE "spaceId" IS NOT NULL AND "departmentId" IS NOT NULL;
CREATE UNIQUE INDEX "Permission_node_membership_key" ON "Permission"("nodeId", "membershipId") WHERE "nodeId" IS NOT NULL AND "membershipId" IS NOT NULL;
CREATE UNIQUE INDEX "Permission_node_department_key" ON "Permission"("nodeId", "departmentId") WHERE "nodeId" IS NOT NULL AND "departmentId" IS NOT NULL;
