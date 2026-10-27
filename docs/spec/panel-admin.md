9. Panel de administración

Ruta: /app/:workspaceSlug/admin/*. Visible solo si el usuario tiene alguna capacidad administrativa; cada sección exige la suya. Todas las acciones del panel quedan en AuditLog.

Visibilidad y gestión de personas (quién ve a quién, alcance por rol y por cargo, jefes que invitan, Seguridad solo del propietario): ver docs/spec/personas.md, que manda sobre lo que diga esta sección.

9.1 Roles de sistema
Rol	Para qué
OWNER	Todo, incluido facturación, transferir propiedad y borrar el workspace. Siempre al menos uno
ADMIN	Todo lo administrativo excepto facturación y borrar el workspace
MEMBER	Usa el contenido según sus departamentos y permisos
GUEST	Externo: solo lo compartido explícitamente, sin ver la lista de miembros
MEMBER (plantilla)	"Jefe de departamento": rol de sistema con capacidades de alcance propio (members.view, departments.members.own, documents.approve.own); se ofrece al nombrar jefe. El alcance real sale del cargo
9.2 Capacidades (para roles personalizados)
members.view        members.invite       members.manage      members.suspend
departments.manage  roles.manage
spaces.create       spaces.manage
content.bypass      permissions.audit
files.manage_trash  storage.view
documents.approve   documents.require_reading   content.public_qr
audit.share         expirations.manage
audit.view          audit.export
security.manage     workspace.settings

Ejemplo de rol personalizado: "Responsable de Calidad" = MEMBER + documents.approve, documents.require_reading, permissions.audit, audit.view. Validar en backend que nadie se asigne capacidades que no tiene.

9.3 Secciones del panel

Resumen (/admin) Tarjetas: plazas completas y de lector usadas vs. plan, invitaciones pendientes, almacenamiento usado vs. plan, documentos por vencer, lecturas pendientes, alertas de seguridad (intentos fallidos, reuso de tokens, accesos externos). Actividad reciente.

Miembros (/admin/members)

Tabla (TanStack Table): nombre, email, rol, departamentos, estado, último acceso, 2FA. Búsqueda, filtros por rol/departamento/estado, orden, paginación del lado del servidor, selección múltiple.
Acciones: invitar (uno o varios emails, rol y departamentos, respetando allowedDomains salvo para GUEST), reenviar o revocar invitación, cambiar rol, asignar departamentos, suspender (revoca sus sesiones en ese workspace), quitar del workspace, cerrar sus sesiones.
Ficha de miembro: datos, departamentos, todo a lo que tiene acceso y por qué, actividad reciente, lecturas pendientes.
Acciones masivas: cambiar departamento, cambiar rol, suspender.
Importar miembros desde CSV con vista previa y validación por fila.
Al quitar a alguien: elegir a quién transferir los nodos que creó.

Departamentos (/admin/departments)

Lista con jerarquía, color, responsable y cantidad de miembros.
Crear, editar, mover bajo otro departamento, eliminar (pide confirmar y muestra qué accesos se pierden).
Detalle: miembros (agregar/quitar en bloque) y qué espacios, carpetas y documentos ve el departamento.

Roles y permisos (/admin/roles)

Roles de sistema (solo lectura) y personalizados.
Editor de rol: nombre, descripción, rol base y capacidades agrupadas por área con interruptores y explicación de cada una.
Vista de matriz: roles en columnas, capacidades en filas.

Espacios y carpetas (/admin/spaces)

Lista de espacios: privacidad, departamentos con acceso, tamaño, cantidad de elementos, responsable.
Crear espacio con plantilla de carpetas sugerida por área (Calidad, RR. HH., Producción, Administración), editable antes de confirmar.
Gestor de accesos del espacio: agregar departamentos o personas con nivel, accesos temporales con vencimiento.

Archivos (/admin/files)

Explorador completo (sección 11.6) con permisos de administrador.
Almacenamiento: uso por espacio y por tipo, archivos más pesados, versiones antiguas que ocupan espacio.
Papelera global: restaurar o eliminar definitivamente (confirmación con el nombre escrito; borra también de S3).

Auditoría de accesos (/admin/access)

Matriz "departamento × espacio" con el nivel en cada celda.
Buscador "¿quién puede ver esto?" y "¿qué puede ver esta persona?".
Reportes: nodos con herencia cortada, accesos directos a personas (señal de desorden), accesos de invitados, accesos que vencen pronto.
Exportar a CSV.

Documentos controlados (/admin/documents)

Listado con código, versión vigente, estado, departamento responsable, próxima revisión. Bandeja de aprobaciones. Cumplimiento de lectura por departamento y por documento. Reglas de numeración por tipo (PRC, INS, FOR, POL, MAN).

Registro de auditoría (/admin/audit)

Tabla filtrable por persona, acción, entidad y fechas; detalle de cada evento; exportar CSV/PDF con los filtros aplicados.

Seguridad (/admin/security) — se guarda en Workspace.settings

Duración máxima de sesión, cierre por inactividad.
Exigir 2FA a administradores o a todos (cuando exista 2FA).
Dominios de email permitidos para invitar.
Permitir o no invitados externos y descarga para invitados.
Política de contraseñas (longitud mínima, ≥ 10).
Cerrar todas las sesiones del workspace.

Configuración (/admin/settings)

Nombre, slug (con aviso de que cambia las URL), logo, color de acento.
Exportar todos los datos (JSON + archivos en ZIP, generado en segundo plano y enviado por email con enlace temporal).
Transferir propiedad. Eliminar workspace (30 días de gracia).

Límites y uso (/admin/limits): uso de la empresa y los límites que fija (docs/spec/limites.md). Licencia y plugins (/admin/license, solo el propietario): estado de la licencia, plugins instalados y cargar la licencia (docs/spec/plugins.md).

Estado (Módulo 2): implementados Miembros (listado del lado del servidor, edición, suspender, quitar, cerrar sesiones, acciones masivas de rol, plaza, departamentos y suspensión, importación CSV y exportación de la lista filtrada), invitaciones, plazas, Departamentos (con detalle de miembros) y Roles y permisos (editor y matriz). Pendientes de otros módulos: la ficha de acceso del miembro ("todo a lo que tiene acceso y por qué"), "qué ve el departamento" con datos reales y la transferencia de lo que creó quien se quita (no hay contenido todavía). Reglas del backend: nadie da capacidades que no tiene ni modifica roles por encima de su nivel; el rol de propietario no se asigna desde el panel; un administrador no gestiona a un propietario; siempre queda un propietario activo; un invitado externo es lector y no entra a departamentos; un lector no tiene capacidades administrativas. Los errores solo llevan details en VALIDATION_ERROR y LIMIT_REACHED.

9.4 API del panel (prefijo /api/v1/w/:slug/admin)
GET    /overview
GET    /members                 ?q&role&department&status&page&sort
GET    /members/:id
PATCH  /members/:id             { roleId?, departmentIds?, jobTitle? }
POST   /members/:id/suspend     POST /members/:id/reactivate
DELETE /members/:id             { transferToMembershipId }
POST   /members/:id/revoke-sessions
POST   /members/bulk            { ids[], action, payload }
GET    /members/export          (mismos filtros que el listado; devuelve { filename, csv, rows })
POST   /members/import          (CSV, devuelve vista previa)  ·  POST /members/import/confirm
POST   /invitations             GET /invitations   DELETE /invitations/:id   POST /invitations/:id/resend
GET    /departments             POST /departments   PATCH /departments/:id   DELETE /departments/:id
POST   /departments/:id/members DELETE /departments/:id/members/:membershipId
GET    /departments/:id/access
GET    /roles                   POST /roles   PATCH /roles/:id   DELETE /roles/:id
GET    /capabilities
GET    /spaces                  POST /spaces  PATCH /spaces/:id  DELETE /spaces/:id
GET    /access/matrix           GET /access/who-can-see/:nodeId   GET /access/what-can-see/:membershipId
GET    /access/reports/:type    GET /access/export.csv
GET    /storage                 GET /trash   POST /trash/:id/restore   DELETE /trash/:id
GET    /audit                   GET /audit/export
GET    /security                PATCH /security
PATCH  /settings                POST /export   POST /transfer-ownership   DELETE /workspace

Cada endpoint: Zod, requireCapability, req.db, entrada en AuditLog, caso en el test de aislamiento.
