-- CreateIndex
CREATE INDEX "Department_managerId_idx" ON "Department"("managerId");

-- CreateIndex
CREATE INDEX "Invitation_workspaceId_createdAt_idx" ON "Invitation"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "Membership_workspaceId_roleId_idx" ON "Membership"("workspaceId", "roleId");

-- CreateIndex
CREATE INDEX "Membership_workspaceId_status_idx" ON "Membership"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "Membership_workspaceId_seatType_idx" ON "Membership"("workspaceId", "seatType");

-- CreateIndex
CREATE INDEX "Membership_workspaceId_createdAt_idx" ON "Membership"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "Membership_workspaceId_lastSeenAt_idx" ON "Membership"("workspaceId", "lastSeenAt");

-- CreateIndex
CREATE INDEX "Role_workspaceId_isSystem_base_idx" ON "Role"("workspaceId", "isSystem", "base");
