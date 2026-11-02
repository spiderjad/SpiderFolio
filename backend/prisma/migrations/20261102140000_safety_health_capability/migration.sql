-- Health data (accidents and fitness for work, docs/spec/seguridad-salud.md) has its own capability:
-- by default only the existing owner system roles get it (new companies get it from systemRoles).
UPDATE "Role" SET "capabilities" = array_append("capabilities", 'safety.health')
WHERE "isSystem" AND "base" = 'OWNER' AND NOT ('safety.health' = ANY("capabilities"));
