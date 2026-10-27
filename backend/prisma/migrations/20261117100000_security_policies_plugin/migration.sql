-- Exigir 2FA a la empresa y los dominios permitidos pasan al plugin security-policies
-- (docs/spec/plugins.md). Lo configurado se copia a PluginSetting antes de quitarlo de Workspace: sin
-- licencia el plugin no se activa, pero los ajustes se conservan para cuando se active.

-- 2FA obligatoria (solo si estaba encendida).
INSERT INTO "PluginSetting" ("id", "workspaceId", "pluginId", "key", "value", "updatedAt")
SELECT 'sp_2fa_' || "id", "id", 'security-policies', 'require2fa', to_jsonb("settings"->>'require2fa'), CURRENT_TIMESTAMP
FROM "Workspace"
WHERE "settings"->>'require2fa' IN ('admins', 'all')
ON CONFLICT ("workspaceId", "pluginId", "key") DO NOTHING;

-- Dominios permitidos (solo si había alguno).
INSERT INTO "PluginSetting" ("id", "workspaceId", "pluginId", "key", "value", "updatedAt")
SELECT 'sp_dom_' || "id", "id", 'security-policies', 'allowedDomains', to_jsonb("allowedDomains"), CURRENT_TIMESTAMP
FROM "Workspace"
WHERE cardinality("allowedDomains") > 0
ON CONFLICT ("workspaceId", "pluginId", "key") DO NOTHING;

UPDATE "Workspace" SET "settings" = "settings" - 'require2fa' WHERE "settings" ? 'require2fa';

-- AlterTable
ALTER TABLE "Workspace" DROP COLUMN "allowedDomains";
