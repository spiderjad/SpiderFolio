-- Expiries of files and pages set before «no responsible chosen = whoever sets it» (docs/spec/vencimientos.md)
-- have no responsible: nobody counted them nor was told. Whoever set it becomes the responsible (setById, or
-- the latest node.expiry.set in the audit log, if they're still active); otherwise the company's owner.
UPDATE "Expiry" e
SET "responsibleId" = COALESCE(
      (SELECT m.id FROM "Membership" m
        WHERE m.id = e."setById" AND m."workspaceId" = e."workspaceId" AND m.status = 'ACTIVE'),
      (SELECT m.id FROM "AuditLog" a
         JOIN "Membership" m ON m."userId" = a."actorId" AND m."workspaceId" = e."workspaceId"
        WHERE a."workspaceId" = e."workspaceId"
          AND a.action = 'node.expiry.set'
          AND a."entityType" = 'Node'
          AND a."entityId" = e."subjectId"
          AND m.status = 'ACTIVE'
        ORDER BY a."createdAt" DESC
        LIMIT 1),
      (SELECT m.id FROM "Membership" m
         JOIN "Role" r ON r.id = m."roleId"
        WHERE m."workspaceId" = e."workspaceId" AND r.base = 'OWNER' AND m.status = 'ACTIVE'
        ORDER BY m."createdAt" ASC
        LIMIT 1)
    ),
    "setById" = COALESCE(e."setById",
      (SELECT m.id FROM "AuditLog" a
         JOIN "Membership" m ON m."userId" = a."actorId" AND m."workspaceId" = e."workspaceId"
        WHERE a."workspaceId" = e."workspaceId"
          AND a.action = 'node.expiry.set'
          AND a."entityType" = 'Node'
          AND a."entityId" = e."subjectId"
        ORDER BY a."createdAt" DESC
        LIMIT 1))
WHERE e.kind = 'node'
  AND e."responsibleId" IS NULL
  AND e."responsibleDepartmentId" IS NULL;
