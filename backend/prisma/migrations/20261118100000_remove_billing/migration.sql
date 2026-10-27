-- SpiderFolio deja de ser un SaaS con planes (docs/spec/limites.md): sin catálogo de precios,
-- suscripción, prueba, solo lectura por suscripción, consultas extra de Bian ni pedidos al equipo.
-- Por defecto no hay límites: la empresa fija los que quiera en Workspace.limits (vacío = ninguno).
-- IRREVERSIBLE: borra las tablas de cobro y sus datos. El contador mensual de Bian (UsageCounter) y
-- los límites por persona y departamento (BianLimit) se conservan.

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN "limits" JSONB NOT NULL DEFAULT '{}';

-- DropTable (el trigger de inmutabilidad se va con la tabla; la función la sigue usando AuditLog)
DROP TABLE "Subscription";
DROP TABLE "PlanCatalogVersion";
DROP TABLE "AiQueryBonus";
DROP TABLE "StaffRequest";

-- DropEnum
DROP TYPE "SubStatus";

-- La capacidad billing.manage deja de existir (la licencia la carga el propietario).
UPDATE "Role" SET "capabilities" = array_remove("capabilities", 'billing.manage')
WHERE 'billing.manage' = ANY("capabilities");
