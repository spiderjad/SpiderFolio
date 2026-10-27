-- Rol de sistema "Jefe de departamento" (capacidades con alcance propio): no se borra ni se edita.
-- Los workspaces que ya tenían uno con ese nombre lo conservan, ahora como rol de sistema.
UPDATE "Role" SET "isSystem" = true WHERE "name" = 'Jefe de departamento';

INSERT INTO "Role" ("id", "workspaceId", "name", "description", "base", "capabilities", "isSystem")
SELECT gen_random_uuid()::text, w."id", 'Jefe de departamento',
       'Gestiona a las personas de los departamentos que lidera y aprueba sus documentos.',
       'MEMBER', ARRAY['members.view', 'departments.members.own', 'documents.approve.own'], true
FROM "Workspace" w
WHERE NOT EXISTS (
  SELECT 1 FROM "Role" r WHERE r."workspaceId" = w."id" AND r."name" = 'Jefe de departamento'
);
