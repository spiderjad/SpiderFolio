-- Inmutabilidad en la base, además de en el código (CLAUDE.md, secciones 6 y 9A.3).
--
-- PlanCatalogVersion: una versión nunca se modifica; un cambio de catálogo inserta otra.
-- AuditLog: append-only; los registros no se modifican. El borrado queda permitido solo para
-- la retención por plan (job semanal) y la purga de un workspace eliminado.

CREATE FUNCTION prolijo_reject_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% es inmutable: no se permite UPDATE', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER "PlanCatalogVersion_no_update"
  BEFORE UPDATE ON "PlanCatalogVersion"
  FOR EACH ROW EXECUTE FUNCTION prolijo_reject_update();

CREATE TRIGGER "AuditLog_no_update"
  BEFORE UPDATE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION prolijo_reject_update();
