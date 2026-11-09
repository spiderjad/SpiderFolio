-- The new environment capabilities for the existing owner and admin system roles (new companies get
-- them from systemRoles).
UPDATE "Role" SET "capabilities" = array_append("capabilities", 'environment.manage')
WHERE "isSystem" AND "base" IN ('OWNER', 'ADMIN') AND NOT ('environment.manage' = ANY("capabilities"));
UPDATE "Role" SET "capabilities" = array_append("capabilities", 'environment.view')
WHERE "isSystem" AND "base" IN ('OWNER', 'ADMIN') AND NOT ('environment.view' = ANY("capabilities"));
UPDATE "Role" SET "capabilities" = array_append("capabilities", 'environment.record')
WHERE "isSystem" AND "base" IN ('OWNER', 'ADMIN') AND NOT ('environment.record' = ANY("capabilities"));
