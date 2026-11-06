# Seguridad y salud laboral

Núcleo, abierto y gratis. Plan aprobado el 02/11/2026. Se apoya en lo que ya existe: formularios y
registros (docs/spec/formularios.md), documentos controlados, lectura obligatoria, QR y los avisos de las
8:00 de cada empresa. Fuera de esta versión: la CAE (módulo del núcleo aparte, activable por empresa como este; ver docs/plans/pendientes.md), las estadísticas oficiales (Delt@,
índices de frecuencia) y las integraciones con mutuas.

## Activación y términos

- Se activa o desactiva por empresa en **Administración › Seguridad › General** (solo el propietario,
  `workspace.settings`), junto al idioma y la zona horaria: `GET/PUT /admin/safety`. Se guarda en
  `Workspace.settings.safety` = `{ enabled, terms, spaceId? }`.
- **Términos** (`terms`): `es` (España: PRL, EPI, «Técnico de prevención») o `latam` (Latinoamérica: SST,
  EPP, «Responsable de SST»). En inglés siempre OHS y PPE. Los textos viven en `i18n` con las dos
  variantes; la app los elige con `membership.workspace.safety.terms`.
- La **primera** activación crea, una sola vez:
  - un espacio de la empresa «Prevención de riesgos laborales» / «Seguridad y salud en el trabajo»
    (su id queda en `settings.safety.spaceId`; si se borra, la siguiente activación crea otro);
  - el tipo de documento **EVR** «Evaluación de riesgos» (revisión cada 12 meses), si no existe;
  - opcional, los ejemplos del sector alimentario de cada parte ya hecha (puestos en la fase 1; EPIs,
    formularios y cursos en sus fases). Nunca pisa lo que la empresa ya tenga con el mismo nombre.
- Desactivar oculta el menú, las pantallas y los avisos del módulo. **Nunca borra datos**; volver a
  activarlo los muestra como estaban.
- Auditoría: `safety.enable`, `safety.disable`, `safety.terms`.

## Permisos

- **`safety.manage`**: EPIs, formación y evaluaciones de riesgos. La tienen el propietario y el rol
  Administrador; los demás, por su rol.
- **`safety.health`**: los **datos de salud**, accidentes e incidentes y aptitud. Por defecto **solo el
  propietario** (el rol Administrador no la tiene, y quien no la tiene no puede darla); se asigna
  explícitamente al técnico de prevención con un rol propio. La pantalla de roles explica por qué es
  delicada. Decidido con el mantenedor el 02/11/2026.
- Cada persona ve **su propia ficha** (EPIs, formación y aptitud; los accidentes solo los ve
  `safety.health`).
- Jefes y subjefes ven los EPIs y la formación de las personas de su área (y subáreas); **no** los
  accidentes ni la aptitud.
- Cualquier persona puede **comunicar** un incidente o casi accidente (también desde un QR); solo
  `safety.health` lo completa, lo investiga y lo cierra.
- Todo se valida en el backend; un recurso de otra empresa responde 404. Auditoría de cada alta, cambio,
  entrega, cierre y exportación. Tests de permisos y de aislamiento entre empresas en cada fase.

## Datos personales

- **Aptitud**: solo `APT`, `APT_RESTRICTED` («apto con restricciones») o `NOT_APT`, con fecha de
  vencimiento. Sin diagnóstico ni campos médicos; las restricciones, si las hay, se describen como tareas
  que no puede hacer, nunca como causas.
- **Accidentes**: describen una lesión, que es dato de salud (RGPD, art. 9). Acceso restringido a
  `safety.health`, sin campo de diagnóstico, aviso en la descripción («No escribas datos médicos»), fuera
  de Bian, del conector MCP y de la búsqueda general.

## Puestos (núcleo, fuera del módulo)

Lista de puestos de la empresa en **Administración › Puestos**, junto a Departamentos; la usa cualquier
parte del núcleo (por ejemplo, lecturas obligatorias por puesto) y el módulo.

- `Position` `{ id, workspaceId, name (1 a 80, único en la empresa sin distinguir mayúsculas),
  description?, createdAt }`. `Membership.positionId` (sin FK, como Mention): **un puesto por persona**.
  Borrar un puesto deja sin puesto a sus personas (en la misma transacción).
- El campo de texto libre que hoy se llama «Puesto» (`Membership.jobTitle`, lo escribe cada persona en su
  perfil) pasa a llamarse **«Cargo»**: es lo que se muestra junto al nombre; el puesto de la lista es lo
  que asigna la empresa y lo que genera obligaciones.
- API: `GET /admin/positions` (cursor, `q`, con el número de personas), `POST /admin/positions`,
  `PATCH /admin/positions/:id`, `DELETE /admin/positions/:id`. Ver: `members.view` o
  `departments.manage`; crear, cambiar y borrar: `departments.manage`. Asignar a una persona: al
  editarla en Miembros (`members.manage`, `positionId`). Miembros filtra por puesto (`position`).
- Auditoría: `position.create`, `position.update`, `position.delete`; el cambio de puesto de una persona
  va en `member.update`.
- **Lecturas obligatorias por puesto** (fase 4): `ReadRequirement.positionId`, junto a departamento y
  persona; sirve con el módulo activado o no.

## Motor de vencimientos (núcleo, genérico)

Una fecha que vence sobre **cualquier tipo de elemento**, con avisos. Por ahora lo usa solo este módulo;
después se apoyan en él la pantalla general de Vencimientos (docs/spec/adopcion.md, 9C.7) y la CAE.

- `Expiry` `{ id, workspaceId, kind, subjectId, membershipId?, responsibleId?, dueOn (día de la empresa,
  DATE), noticeDays (por defecto [30, 7, 0]), noticesSent (los umbrales ya avisados), resolvedAt?,
  createdAt, updatedAt }`, único por `(workspaceId, kind, subjectId)`.
  - `kind`: tipo de elemento, con prefijo de quien lo usa (`safety.ppe`, `safety.training`,
    `safety.fitness`; después `node`, `cae.document`…).
  - `subjectId`: el elemento en su propia tabla (sin FK). `membershipId`: la persona de la que se trata,
    si la hay (para su ficha). `responsibleId`: quién debe ocuparse.
  - `resolvedAt`: renovado, reemplazado o ya no aplica; no avisa más.
- Servicio (`modules/expiries`): `setExpiry(db, input)` (crea o mueve la fecha; moverla vuelve a armar los
  avisos), `resolveExpiry(db, kind, subjectId)`, `expiriesOf(db, { membershipId | kind, estado })` y un
  **registro de tipos** `registerExpiryKind(kind, { recipients, describe })`: a quién se avisa (por
  defecto, `responsibleId` y la persona) y cómo se nombra y adónde lleva el aviso. Un tipo no registrado
  no avisa.
- Estado calculado con el día de la empresa: `valid`, `due_soon` (dentro del mayor umbral) o `expired`.
- Avisos: job horario `expiry-notices` que solo toma las empresas donde son las 8:00. Para cada
  vencimiento sin resolver, si `dueOn − hoy` alcanzó un umbral no avisado, manda **un** aviso
  `expiry_due` (campana y email; `Notification.expiryId`, `detail` = días que faltan) y marca como
  avisados ese umbral y los mayores. Una vez por persona y umbral (`dedupeKey`). Un vencimiento creado
  ya vencido avisa una sola vez.
- Tests: umbrales y estado (unitarios); job, registro de tipos y aislamiento entre empresas
  (integración, con un tipo de prueba).

## EPIs (fase 2)

- **Catálogo** de la empresa: `SafetyItem` `{ name, category, sizes (con talla o no), lifeMonths?,
  positionIds[], archivedAt? }`. Archivar en vez de borrar si ya se entregó.
- **Entrega** desde una pantalla propia (`safety.manage`): persona, EPIs con cantidad y talla, firma de
  quien recibe con el dedo (el mismo componente de firma y la misma subida de Formularios), observaciones.
  `SafetyDelivery` + `SafetyDeliveryLine`; inmutable, se puede anular con motivo como un registro.
  Constancia de entrega en PDF (Gotenberg).
- **Historial por persona** y **reposición**: cada línea con vida útil crea un vencimiento
  `safety.ppe` (entrega + vida útil, persona y responsable = quien entregó); una entrega nueva del mismo
  EPI a la misma persona resuelve el anterior.
- «**Le falta**»: los EPIs que su puesto requiere y no tiene vigentes.

## Accidentes e incidentes (fase 3)

- **Formulario base del sistema** «Accidente o incidente», en el espacio del módulo, con campos fijos que
  la empresa no puede quitar ni cambiar de tipo (id reservados): fecha y hora, lugar, persona afectada,
  tipo (accidente con baja, sin baja, incidente, casi accidente), gravedad (leve, grave, muy grave,
  mortal), qué pasó, causas, fotos y testigos. Puede agregarle campos propios.
- Tipo de campo nuevo en Formularios: **Persona** (un miembro de la empresa), útil también fuera del
  módulo.
- `SafetyIncident` `{ recordId, type, severity, occurredAt, membershipId?, departmentId?, status (OPEN,
  INVESTIGATING, CLOSED), closedAt? }`: lo estructurado del registro para filtrar y seguir.
- **Comunicar**: cualquiera con acceso lo llena (también por QR); queda abierto y avisa a quienes tienen
  `safety.health`.
- **Medidas**: `SafetyAction` `{ incidentId, description, responsibleId, dueOn, doneAt?, note? }`; cada una
  crea un vencimiento `safety.action` (aviso al responsable) que se resuelve al marcarla hecha. Con todas
  hechas, se puede cerrar el caso.
- **Listado** con filtros en la URL (fechas, tipo, gravedad, persona, departamento, estado) y CSV.

## Formación y evaluaciones (fase 4)

- **Curso**: `SafetyCourse` `{ nodeId (un documento controlado), validityMonths?, requiredFor (puestos,
  departamentos, personas) }`. Usa la lectura obligatoria (con `ReadRequirement.positionId`).
- **Constancia**: `SafetyTraining` `{ courseId, membershipId, completedAt, source (READING | IN_PERSON),
  recordId? }`; el «Leí y comprendo» de la versión vigente la crea. Con validez, crea un vencimiento
  `safety.training`; al vencer se vuelve a pedir la lectura aunque la versión no haya cambiado.
- **Formación presencial**: formulario base «Asistencia a formación» (curso, asistentes, firma de cada
  uno) que crea las constancias.
- **Evaluaciones de riesgos**: documentos controlados del tipo EVR, con aviso de revisión al
  departamento responsable cuando se acerca `reviewDueAt` (hoy solo se ve en Inicio).

## Aptitud y ficha por persona (fase 5)

- `SafetyFitness` `{ membershipId, status, validUntil?, restrictions?, createdById }`: la última vale;
  las anteriores quedan como historial. Vencimiento `safety.fitness`.
- **Personas** (`/app/:slug/seguridad/personas`, `GET /safety/people`): la lista con buscador, puesto,
  departamento y avisos (EPIs que faltan, cursos vencidos o pendientes, aptitud por vencer con
  `safety.health`); se llega también desde el menú de cada persona en Miembros y, a la propia, desde «Mi
  ficha» y Mi perfil.
- **Ficha** (`/app/:slug/seguridad/personas/:membershipId`): puesto, EPIs vigentes, vencidos y faltantes,
  formación (hecha, por vencer, pendiente) y, solo para `safety.health`, aptitud de otras personas y
  accidentes. Exportable a
  PDF.
- Ejemplos del sector alimentario completos, guías es/en, capturas y versión.

## Fases

1. **Activación, términos, permisos, puestos y motor de vencimientos** (hecha). `safety.manage`;
   `Administración › Seguridad › General` con el módulo; `Position` y Administración › Puestos (y en
   Miembros: filtro y asignación); `Expiry`, su registro de tipos y el job `expiry-notices`, con el aviso
   `expiry_due` en la campana y por email; espacio y tipo EVR al activar; ejemplos de puestos del sector
   alimentario. El campo de texto «Puesto» de cada persona pasa a llamarse «Cargo». Captura `puestos` en la
   guía de Departamentos; `seguridad` y `miembros` regeneradas.
2. **EPIs** (hecha): catálogo, entrega con firma, constancia, historial, reposición y «Le falta».
   La firma se guarda en la entrega (PNG, `SafetyDelivery.signature`) y el panel de firma es el mismo de
   Formularios (`components/signature-pad.tsx`). Pantallas `/app/:slug/seguridad/epis` (entregas, con
   filtros en la URL), `…/epis/catalogo`, `…/epis/nueva?persona=`, `…/epis/:id` y
   `…/personas/:membershipId` (ficha, por ahora solo EPIs). El tipo de vencimiento `safety.ppe` queda en
   pausa con el módulo apagado (`ExpiryKind.paused`: ni avisa ni se resuelve). Guía «Seguridad y salud
   laboral» y capturas `epis*`.
3. **Accidentes e incidentes** (hecha): formulario base, campo Persona, comunicar, medidas con
   vencimiento, listado y CSV. Simplificaciones: el caso tiene solo los estados `OPEN` y `CLOSED` (sin
   «en investigación»); el aviso de caso nuevo (`safety_incident`) va solo a la campana; las medidas avisan
   7 días antes, el anterior y el mismo día (`safety.action`) y el responsable las ve en «Mis medidas» sin
   los datos del caso. El formulario base se crea al activar el módulo (`settings.safety.incidentFormId`)
   y sus campos fijos se validan al guardar la plantilla (`incident-form.ts`). Sin capturas todavía.
4. **Formación y evaluaciones** (hecha): lecturas por puesto (`ReadRequirement.positionId`, en el núcleo;
   solo quien pide lecturas en toda la empresa), cursos (`SafetyCourse` sobre un documento controlado;
   quiénes salen de sus lecturas obligatorias), constancias (`SafetyTraining`: el «Leí y comprendo» de un
   curso, o presencial; vencimiento `safety.training` y «Confirmar que lo hice de nuevo» al vencer) y aviso
   de revisión de las EVR publicadas (`safety.review`, a los jefes del departamento responsable).
   La formación presencial la registra quien gestiona el módulo: asistentes, fecha y la firma de cada uno
   en la misma pantalla (`SafetyTraining.signature`), con la hoja de asistencia firmada en PDF. Pendiente:
   que cada asistente firme desde su propio celular. `safety.manage` ve la lista de documentos controlados
   y el cumplimiento de lecturas de Administración, no las aprobaciones (decidido con el mantenedor).
5. **Aptitud, ficha por persona** (hecha): `SafetyFitness` (solo `safety.health` registra y ve la de
   otros; cada uno ve la suya; vencimiento `safety.fitness`; la auditoría no guarda el resultado), ficha con
   EPIs, formación, aptitud y accidentes (estos dos solo con `safety.health`), ejemplos del sector
   alimentario (puestos, catálogo de EPIs e «Inspección de seguridad mensual»), guías y capturas
   (`accidentes`, `formacion`, `epis-ficha`). Pendiente: la ficha exportable a PDF y la firma de la
   asistencia desde el celular de cada uno. La versión la publica quien mantiene el proyecto tras probar.

Cada fase: commit propio, tests de lo tocado (permisos y aislamiento entre empresas incluidos) y guías
es/en de las pantallas que cambian.

## Pendientes hechos (03/11/2026)

- **Firma desde el celular** (`SafetySignSession`): quien gestiona el módulo abre una firma para un curso, un
  día y una lista de asistentes (`POST /safety/courses/:id/sign-sessions`); devuelve el enlace
  `/app/:slug/seguridad/firmar/:id` y su QR. Cada asistente de la lista (y nadie más) firma una sola vez, por sí
  mismo (`POST /safety/sign-sessions/:id/sign`, índice único sesión + persona); queda como `SafetyTraining`
  `IN_PERSON` con `sessionId` y `createdById` = quien la dio, así que la constancia PDF del día las incluye.
  Quien la dio ve quién firmó (la pantalla consulta cada 3 s) y la cierra cuando quiere; vence sola a las 24 h.
  Auditoría `safety.training.session.open|sign|close`. El login y la pantalla de PIN vuelven al enlace (`next`).
- **En investigación**: estado `INVESTIGATING` de los casos, entre `OPEN` y `CLOSED`
  (`POST /safety/incidents/:id/investigate`); el filtro «abiertos» lo incluye. Auditoría
  `safety.incident.investigate`.
- **Email del caso nuevo** (`safety-incident-notice`) a quienes tienen `safety.health`: quién lo comunicó y el
  enlace, nunca qué pasó ni a quién.
- **Ficha por persona en PDF** (`GET /safety/people/:id/pdf`): EPIs y formación para quien ve a la persona;
  aptitud para ella misma y `safety.health`; accidentes solo con `safety.health`. Auditoría
  `safety.person.export` (qué partes, sin contenido).
