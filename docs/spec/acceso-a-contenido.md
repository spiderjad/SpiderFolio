8. Acceso a contenido
8.1 Niveles

MANAGE (gestiona permisos, mueve, borra) > EDIT (crea, edita, sube versiones) > COMMENT > VIEW (ve y descarga).

8.2 Resolución (resolveAccess(membership, target))
OWNER y ADMIN (o capacidad content.bypass) tienen MANAGE en todo.
Se juntan los permisos vigentes (no vencidos) dados a la persona y a todos sus departamentos, incluidos los departamentos padre.
Si el nodo tiene inheritAccess = true, se suman los del padre, y al llegar a la raíz, los del espacio. Si es false, la herencia se corta ahí.
Espacio no privado: todo miembro MEMBER tiene VIEW en su raíz salvo que un nodo corte la herencia. GUEST solo ve lo compartido explícitamente.
Espacios de departamento: jefe y subjefe del departamento (o de uno superior) tienen MANAGE; los miembros del departamento entran con el nivel del espacio; los de los subdepartamentos solo si el espacio tiene "Incluir subáreas" (desactivada por defecto).
Espacio confidencial (además de Normal y Privado; implica privado): ADMIN y content.bypass no entran solos. Entran el propietario del workspace, el jefe y subjefe del departamento (y de áreas superiores), sus miembros y quien se agregue explícitamente.
Gana el nivel más alto. Sin nivel: el nodo no aparece en árbol, búsqueda, favoritos, recientes ni IA.

Una sola función, con tests exhaustivos y una tabla de casos. Para listar árboles, resolver en lote (una consulta por nivel, sin N+1) y cachear por request.

8.3 Explicación de accesos

GET /api/v1/w/:slug/nodes/:id/access devuelve cada persona con acceso, su nivel y el motivo: "Departamento Calidad · heredado de /Procedimientos", "Directo · vence 30/11", "Administrador del workspace", "Jefe de Finanzas (área superior)", "Miembro de Contabilidad · incluye subáreas". El diálogo "Compartir" y el panel de administración lo muestran tal cual.
