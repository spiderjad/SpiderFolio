-- El cargo (jefe o subjefe) es la única fuente de los permisos de jefe: se elimina el rol de sistema
-- "Jefe de departamento". Quien lo tenía pasa a Miembro (su cargo en el departamento no cambia);
-- las invitaciones pendientes con ese rol también. No se borra ninguna persona ni cargo.
UPDATE "Membership" m
SET "roleId" = (
  SELECT member."id" FROM "Role" member
  WHERE member."workspaceId" = m."workspaceId" AND member."isSystem" AND member."base" = 'MEMBER'
    AND member."name" = 'Miembro'
  LIMIT 1
)
FROM "Role" manager
WHERE m."roleId" = manager."id" AND manager."isSystem" AND manager."name" = 'Jefe de departamento';

UPDATE "Invitation" i
SET "roleId" = (
  SELECT member."id" FROM "Role" member
  WHERE member."workspaceId" = i."workspaceId" AND member."isSystem" AND member."base" = 'MEMBER'
    AND member."name" = 'Miembro'
  LIMIT 1
)
FROM "Role" manager
WHERE i."roleId" = manager."id" AND manager."isSystem" AND manager."name" = 'Jefe de departamento';

DELETE FROM "Role" WHERE "isSystem" AND "name" = 'Jefe de departamento';

-- Las capacidades con alcance (".own") dejaron de existir: el alcance sale del cargo.
UPDATE "Role"
SET "capabilities" = array_remove(array_remove("capabilities", 'departments.members.own'), 'documents.approve.own')
WHERE "capabilities" && ARRAY['departments.members.own', 'documents.approve.own'];
