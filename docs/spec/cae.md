# CAE: coordinación de actividades empresariales

Núcleo, abierto y gratis. Decidido con el mantenedor el 07/11/2026. Va **dentro de Prevención**
(docs/spec/seguridad-salud.md) como pestaña «Contratas (CAE)» / «Contratistas», con su propio interruptor:
no todas las empresas trabajan con contratas. Marco: Ley 31/1995, art. 24, y Real Decreto 171/2004
(España); en Latinoamérica, la obligación equivalente de cada país (términos `latam`).

Lo que resuelve: saber **qué empresas externas trabajan en el centro, si su documentación y la de cada
trabajador está al día, y si cada trabajador puede entrar hoy**; y dejar constancia de que se les dio la
información de riesgos, las medidas de emergencia y las instrucciones del centro.

## Activación

- En **Administración › Seguridad › General**, debajo del módulo: «Coordinación de actividades
  empresariales (CAE)». Solo el propietario. Requiere el módulo activado; apagar el módulo la oculta
  también. Se guarda en `Workspace.settings.safety.cae` = `{ enabled }` (dentro de `SafetySettings`).
- La primera activación crea, una sola vez, la carpeta **«Contratas»** («Contratistas» en `latam`) en el
  espacio del módulo (su id queda en `settings.safety.cae.folderId`) y el **catálogo de documentos
  exigidos** con los de su país (abajo). Nunca pisa lo que la empresa ya tenga con el mismo nombre.
- Desactivar oculta la pestaña, las pantallas y los avisos (los vencimientos `cae.*` quedan en pausa,
  como `safety.ppe`). **Nunca borra datos.**
- Auditoría: `cae.enable`, `cae.disable`.
- Con la CAE apagada o el módulo apagado, toda la API `/cae` responde 404.

## Permisos

- **`cae.manage`**: alta y cambios de empresas, trabajadores y catálogo; subir, aceptar y rechazar
  documentos; bloquear o desbloquear; registrar la entrega de información. Por defecto, propietario y
  Administrador.
- **`cae.check`**: solo **consultar si una empresa o un trabajador está autorizado** (nombre, empresa,
  estado y motivos, sin los documentos ni los datos personales). Pensada para portería y jefes de equipo.
  Nadie la tiene por defecto salvo quien tiene `cae.manage`.
- El **responsable interno** de cada contrata (una persona de la empresa) ve su ficha completa aunque no
  tenga `cae.manage`, y recibe los avisos de vencimiento.
- Los documentos son archivos del espacio del módulo: quien no tiene acceso a la carpeta no los ve,
  aunque vea el estado. Todo se valida en el backend; un recurso de otra empresa responde 404.

## Datos personales

- De cada trabajador externo: nombre, documento de identidad (opcional; solo `cae.manage` y el
  responsable interno lo ven completo; en `cae.check` se muestran los últimos 3 caracteres), puesto o
  tarea y empresa. Sin datos de salud: de la aptitud médica solo se guarda que el certificado se presentó
  y su vencimiento, **nunca el resultado ni restricciones médicas**.
- Los trabajadores externos **no son miembros** de la empresa: no ocupan plaza ni tienen cuenta (el
  portal de contratas, fase 5, es aparte).
- Fuera de Bian, del conector MCP y de la búsqueda general (salvo los archivos, que siguen las reglas de
  cualquier archivo).

## Modelo

- `CaeCompany` `{ id, workspaceId, name (1 a 120, único sin distinguir mayúsculas), nameKey, taxId?
  (CIF/NIF/RUT, hasta 20), kind (CONTRACTOR | SUBCONTRACTOR | CONCURRENT), parentId? (la contrata de la
  que depende una subcontrata), activity (qué hace en el centro, hasta 500), contactName?, contactEmail?,
  contactPhone?, responsibleId (membership, el responsable interno), startsOn?, endsOn?, blockedAt?,
  blockedReason?, archivedAt?, folderId (su carpeta dentro de «Contratas»), createdAt, updatedAt }`.
  - `CONCURRENT`: otra empresa que comparte el centro sin contrato con nosotros (RD 171/2004, cap. II).
  - Archivar en vez de borrar (con documentos o trabajadores); archivada no está autorizada.
- `CaeWorker` `{ id, workspaceId, companyId, name (1 a 120), idNumber? (hasta 20), task? (hasta 120),
  blockedAt?, blockedReason?, archivedAt?, createdAt, updatedAt }`.
- `CaeRequirement` (catálogo) `{ id, workspaceId, name (1 a 120, único), nameKey, scope (COMPANY |
  WORKER), validityMonths? (para proponer el vencimiento), appliesTo (ALL | CONTRACTOR | CONCURRENT;
  SUBCONTRACTOR va con CONTRACTOR), required (si falta, no autoriza), archivedAt?, position }`.
- `CaeDocument` `{ id, workspaceId, requirementId, companyId, workerId? (con scope WORKER), nodeId (el
  archivo, en la carpeta de la empresa), validUntil? (DATE), status (PENDING | ACCEPTED | REJECTED),
  reviewedById?, reviewedAt?, rejectReason?, createdById, createdAt }`. El último ACCEPTED de cada
  (requisito, empresa, trabajador) es el vigente; los anteriores quedan como historial. Con `validUntil`,
  crea un vencimiento `cae.document` (responsable: el responsable interno; resuelve el del documento que
  reemplaza).
- `CaeInfoDelivery` (fase 4) `{ id, companyId, nodeIds[] (documentos controlados entregados, con su
  versión), deliveredOn, receivedBy (nombre de quien la recibe por la contrata), signature? (PNG),
  createdById }`.
- `CaeAccess` (fase 3, opcional por empresa) `{ id, workerId, at, direction (IN | OUT), authorized,
  reasons[], createdById }`: el registro de portería.
- Auditoría de cada alta, cambio, archivo, documento (subida, aceptación, rechazo), bloqueo, entrega de
  información y consulta de portería con resultado negativo.

## Estado y autorización (calculados, nunca guardados)

- **Documento exigido** de una empresa o trabajador: `ok` (ACCEPTED vigente), `due_soon` (dentro de los
  avisos), `expired`, `pending` (subido, sin revisar), `rejected` o `missing`.
- **Empresa autorizada** si no está bloqueada ni archivada, está dentro de `startsOn..endsOn` (si
  existen), y todos sus requisitos `required` de `scope COMPANY` que le aplican están `ok` o `due_soon`. Una
  subcontrata además necesita que su contrata esté autorizada.
- **Trabajador autorizado** si su empresa lo está, él no está bloqueado ni archivado y todos sus
  requisitos `required` de `scope WORKER` están `ok` o `due_soon`.
- Siempre con **motivos legibles**: «Falta: Certificado de estar al corriente con la Seguridad Social»,
  «Vencido el 03/11: Formación PRL del puesto», «Empresa bloqueada: …». La misma función
  (`caeStatus`) la usan la API, las listas, la portería y el PDF.

## Catálogo por defecto

España (`es`):
- Empresa: Seguro de responsabilidad civil y recibo (12 meses); Certificado de estar al corriente con la
  Seguridad Social (1 mes); Certificado de estar al corriente con Hacienda (12 meses); Modalidad de
  organización preventiva; Evaluación de riesgos de los trabajos a realizar; Planificación de la
  actividad preventiva; Relación de trabajadores (RNT/ITA, 1 mes). En CONCURRENT solo la evaluación de
  riesgos y la modalidad preventiva.
- Trabajador: Formación en PRL del puesto; Certificado de aptitud médica (12 meses, solo «presentado»);
  Entrega de EPI; Alta en la Seguridad Social; Información de riesgos del centro recibida.

Latinoamérica (`latam`): los equivalentes con nombres genéricos (Seguro de responsabilidad civil,
Constancia de pago de seguridad social, Matriz de riesgos de los trabajos, Programa de SST,
Capacitación en SST, Aptitud médica, Entrega de EPP, Afiliación a seguridad social, Inducción de
seguridad del centro). La empresa los edita, agrega o archiva.

## API (todo bajo `/api/v1/w/:slug/cae`, con la CAE activada)

- `GET/PUT /admin/safety` suma `cae: { enabled }`.
- Empresas: `GET /companies` (cursor, `q`, `kind`, `status` = authorized | blocked | incomplete |
  archived), `POST /companies`, `GET /companies/:id` (con requisitos y estado), `PATCH /companies/:id`,
  `POST /companies/:id/block` `{ reason }`, `POST /companies/:id/unblock`, `POST /companies/:id/archive`.
- Trabajadores: `GET /companies/:id/workers`, `POST /companies/:id/workers`, `GET /workers/:id`,
  `PATCH /workers/:id`, `POST /workers/:id/block|unblock|archive`; `GET /workers` (todos, cursor, `q`,
  `status`) para portería.
- Catálogo: `GET /requirements`, `POST`, `PATCH /requirements/:id`, `POST /requirements/:id/archive`,
  `PUT /requirements/order`.
- Documentos: `POST /documents` `{ requirementId, companyId, workerId?, nodeId, validUntil? }` (el
  archivo se sube antes con el flujo normal a la carpeta de la empresa; el nodo debe estar dentro de ella),
  `POST /documents/:id/accept` `{ validUntil? }`, `POST /documents/:id/reject` `{ reason }`,
  `GET /documents?status=pending` (la bandeja de revisión).
- Portería: `GET /check/:workerId` (`cae.check`): nombre, empresa, autorizado y motivos.
- Listas con la regla de paginación del proyecto; filtros y orden en la URL.

## Pantallas (`/app/:slug/seguridad/cae…`)

- **Contratas**: lista con buscador, tipo y estado (pastilla verde «Autorizada», ámbar «Incompleta»,
  roja «Bloqueada»), y contador de documentos por revisar.
- **Ficha de la empresa**: datos, responsable interno, requisitos con su estado (subir, ver, aceptar,
  rechazar, historial), trabajadores con su estado, bloquear o archivar. Subir un documento abre el diálogo
  de subida normal apuntando a su carpeta y pide el requisito y el vencimiento (propuesto por
  `validityMonths`).
- **Ficha del trabajador**: igual, con sus requisitos; QR del trabajador (fase 3).
- **Por revisar**: los documentos `PENDING` de todas las empresas.
- **Catálogo**: los requisitos, ordenables.
- **Portería** (fase 3): buscador grande (nombre, documento o QR) que responde en verde «Puede entrar» o
  en rojo con los motivos.

## Fases

1. **Activación, permisos, empresas, trabajadores y catálogo** (hecha): interruptor dentro de Prevención,
   `cae.manage` y `cae.check`, carpeta «Contratas» y una carpeta por empresa, catálogo por defecto,
   altas, cambios, bloqueo y archivo, estado calculado (todavía todo «falta»). Pestaña y pantallas de
   lista, fichas y catálogo.
   Modelos `CaeCompany`, `CaeWorker` y `CaeRequirement` (migración `cae_companies_workers`, que también
   suma `cae.manage` y `cae.check` a los roles de sistema propietario y Administrador existentes; el
   Administrador las tiene las dos). `caeStatus` en `backend/src/modules/safety/cae-status.ts`
   (`companyStatus`, `workerStatus`) ya devuelve el estado por requisito y los motivos; la fase 2 solo
   llena `loadDocuments` y `authorizedCompanyWhere`. Simplificaciones: el filtro de estado de las listas
   (`authorized` / `incomplete`) se calcula en la base con las mismas reglas porque todavía no hay
   documentos (autorizada = sin requisitos obligatorios que le apliquen, dentro de sus fechas, sin bloqueo
   ni archivo, y su contrata igual); una subcontrata depende siempre de una contrata (un solo nivel); el
   catálogo no tiene `due_soon` hasta que haya documentos; las carpetas las crea el sistema sin pedir
   permiso de edición en el espacio (si «Contratas» o la carpeta de una empresa se borra, se vuelve a crear
   al dar de alta o renombrar). Sin pestaña para el responsable interno sin `cae.manage` ni `cae.check`
   (la API ya le deja ver sus empresas). `GET /workers` y `GET /check` quedan para la portería (fase 3);
   el primero ya existe. Capturas pendientes (docs/plans/pendientes.md).
2. **Documentos** (hecha): subir a la carpeta, aceptar o rechazar, vigente e historial, vencimientos
   `cae.document` con avisos al responsable interno, bandeja «Por revisar», estado y autorización reales.
   Migración `cae_documents`: `CaeDocument` (con `supersededAt`: el vigente es el ACCEPTED sin
   reemplazar, único por requisito, empresa y trabajador) y `CaeWorker.folderId` (cada trabajador tiene
   una subcarpeta con su nombre dentro de la de su empresa, creada con su primer documento y renombrada con
   él). Subir: la app pide la carpeta (`POST /companies/:id/folder`, `POST /workers/:id/folder`, que la
   recrean si falta), sube con la cola normal de archivos y al terminar llama a `POST /documents`; el
   backend exige un FILE vivo dentro del subárbol de la carpeta de la empresa. «Aceptar ya» en el mismo
   diálogo (`accept: true`). Sin `validUntil`, se propone hoy + `validityMonths`. Historial:
   `GET /documents?requirementId&companyId|workerId`. `due_soon` = 30 días o menos (los avisos por
   defecto, 30/7/0). El filtro de estado de las listas es una consulta exacta en la base (un documento
   ACCEPTED sin reemplazar y sin vencer por cada requisito obligatorio que aplica a su tipo, también para
   la contrata de una subcontrata). Simplificaciones: un documento cuyo archivo está en la papelera
   sigue contando hasta que otro lo reemplace (se puede restaurar); aceptar un PENDING más viejo que el
   vigente lo reemplaza igual; solo se revisan los PENDING (no se revoca un aceptado; se sube otro); el
   responsable interno ve los nombres de los archivos de sus empresas aunque no tenga acceso a la carpeta
   (abrirlos sí lo exige); para subir hace falta poder editar en el espacio del módulo.
3. **Portería y acceso**: `GET /check`, pantalla de portería, QR por trabajador, registro de entradas y
   salidas opcional, PDF «Autorizados hoy» por empresa.
4. **Información y permisos de trabajo**: entrega de la información del centro (riesgos, emergencias,
   normas: documentos controlados marcados para la CAE) con firma de quien la recibe; permisos de trabajo
   (trabajos en caliente, en altura, espacios confinados, eléctricos) con validez, firmas y cierre.
5. **Portal de contratas**: que la contrata suba sus propios documentos con un acceso propio. **Toca
   seguridad (acceso externo): se decide con el mantenedor antes de empezar** (opciones: enlace con código
   como las salas de auditoría, o cuentas de invitado).
6. Ejemplos del sector alimentario, guías es/en, capturas y versión.

Cada fase: commit propio y guías es/en de las pantallas que cambian. Tests de permisos y de aislamiento
entre empresas: todos juntos al cerrar el módulo (CLAUDE.md, «Pruebas»).
