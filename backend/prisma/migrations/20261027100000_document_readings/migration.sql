-- CreateTable
CREATE TABLE "ReadRequirement" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "departmentId" TEXT,
    "membershipId" TEXT,
    "includeSubareas" BOOLEAN NOT NULL DEFAULT false,
    "dueAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReadRequirement_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ReadRequirement_one_subject" CHECK (("departmentId" IS NULL) <> ("membershipId" IS NULL))
);

-- CreateTable
CREATE TABLE "ReadAcknowledgment" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "membershipId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReadAcknowledgment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReadRequirement_workspaceId_nodeId_version_idx" ON "ReadRequirement"("workspaceId", "nodeId", "version");

-- Un solo requisito por versión y departamento, y uno por versión y persona.
CREATE UNIQUE INDEX "ReadRequirement_department_key" ON "ReadRequirement"("nodeId", "version", "departmentId") WHERE "departmentId" IS NOT NULL;
CREATE UNIQUE INDEX "ReadRequirement_person_key" ON "ReadRequirement"("nodeId", "version", "membershipId") WHERE "membershipId" IS NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "ReadAcknowledgment_nodeId_version_membershipId_key" ON "ReadAcknowledgment"("nodeId", "version", "membershipId");

-- CreateIndex
CREATE INDEX "ReadAcknowledgment_workspaceId_membershipId_idx" ON "ReadAcknowledgment"("workspaceId", "membershipId");

-- AddForeignKey
ALTER TABLE "ReadRequirement" ADD CONSTRAINT "ReadRequirement_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReadRequirement" ADD CONSTRAINT "ReadRequirement_nodeId_workspaceId_fkey" FOREIGN KEY ("nodeId", "workspaceId") REFERENCES "Node"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReadAcknowledgment" ADD CONSTRAINT "ReadAcknowledgment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReadAcknowledgment" ADD CONSTRAINT "ReadAcknowledgment_nodeId_workspaceId_fkey" FOREIGN KEY ("nodeId", "workspaceId") REFERENCES "Node"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;
