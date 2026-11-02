-- CreateTable
CREATE TABLE "SafetyIncident" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT,
    "occurredOn" DATE NOT NULL,
    "place" TEXT,
    "membershipId" TEXT,
    "departmentId" TEXT,
    "reportedById" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SafetyIncident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SafetyAction" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "responsibleId" TEXT NOT NULL,
    "dueOn" DATE NOT NULL,
    "doneAt" TIMESTAMP(3),
    "doneById" TEXT,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SafetyAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SafetyIncident_workspaceId_occurredOn_idx" ON "SafetyIncident"("workspaceId", "occurredOn");

-- CreateIndex
CREATE INDEX "SafetyIncident_workspaceId_status_idx" ON "SafetyIncident"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SafetyIncident_workspaceId_recordId_key" ON "SafetyIncident"("workspaceId", "recordId");

-- CreateIndex
CREATE UNIQUE INDEX "SafetyIncident_id_workspaceId_key" ON "SafetyIncident"("id", "workspaceId");

-- CreateIndex
CREATE INDEX "SafetyAction_workspaceId_incidentId_idx" ON "SafetyAction"("workspaceId", "incidentId");

-- CreateIndex
CREATE INDEX "SafetyAction_workspaceId_responsibleId_doneAt_idx" ON "SafetyAction"("workspaceId", "responsibleId", "doneAt");

-- AddForeignKey
ALTER TABLE "SafetyIncident" ADD CONSTRAINT "SafetyIncident_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyAction" ADD CONSTRAINT "SafetyAction_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyAction" ADD CONSTRAINT "SafetyAction_incidentId_workspaceId_fkey" FOREIGN KEY ("incidentId", "workspaceId") REFERENCES "SafetyIncident"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;
