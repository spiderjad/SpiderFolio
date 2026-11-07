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
3. **Portería y acceso** (hecha): `GET /check`, pantalla de portería, QR por trabajador, registro de entradas y
   salidas opcional, PDF «Autorizados hoy» por empresa.
   `GET /check?q=` (nombre, final del documento o nombre de la empresa; solo trabajadores y empresas
   activos) y `GET /check/:workerId`, para `cae.check` o `cae.manage`: nombre, empresa, tarea, documento
   enmascarado, autorizado, motivos y, con registro, el último acceso de hoy. Solo `GET /check/:workerId`
   audita (`cae.check.denied`, si no autoriza); la búsqueda no. Pantalla `/seguridad/cae/porteria`
   (`?trabajador=` elige a la persona). Quien solo tiene `cae.check` entra al módulo directo a la portería
   y en las pestañas solo ve Contratas (su propia ficha sigue en Mi perfil, como la de cualquiera). QR:
   `GET /workers/:id/qr` devuelve la URL de la portería y el QR como data URL (`qrcode`, ya en el backend,
   como las firmas de formación); el QR de nodos (`modules/qr`) no sirve porque apunta a nodos con token
   público. La tarjeta se imprime desde una ventana propia. Registro: `settings.safety.cae.accessLog`
   (propietario, junto al interruptor; auditoría `cae.access_log.enable|disable`, y `caeAccessLog` en
   `/me`), migración `cae_access` (`CaeAccess` con `companyId` además de `workerId`, solo se agrega y se
   lee), `POST /access` `{ workerId, direction }` (una entrada sin autorización responde 409; una salida
   siempre se registra) y `GET /access?day&companyId` (paginado; por día, hoy por defecto). PDF:
   `GET /companies/:id/pdf` (Gotenberg, auditoría `cae.company.export`), para quien ve la empresa (también
   `cae.check`, que ve lo mismo que en portería); hasta 2000 trabajadores, documentos enmascarados.
   Simplificaciones: los accesos no se corrigen ni se anulan; la lista de accesos no tiene exportación; el
   responsable interno sin `cae.check` no ve la portería ni los accesos.
4. **Información y permisos de trabajo** (hecha): entrega de la información del centro (riesgos, emergencias,
   normas: documentos controlados marcados para la CAE) con firma de quien la recibe; permisos de trabajo
   (trabajos en caliente, en altura, espacios confinados, eléctricos) con validez, firmas y cierre.
   Migración `cae_info_permits`: `CaeInfoDelivery` (los ítems entregados como foto `{ nodeId, version,
   code, title }` más `deliveredKeys` «nodeId@versión» para consultar en la base; firma PNG opcional) y
   `CaeWorkPermit`; las dos solo se agregan (y el permiso se actualiza al aprobarlo, cerrarlo o anularlo),
   nunca se borran. Información: la lista de documentos es `settings.safety.cae.infoNodeIds` (no una
   marca por documento controlado) y `infoRequired` (por defecto sí), que se editan en el Catálogo
   (`GET/PUT /cae/info`, `GET /cae/info/options`: documentos controlados vigentes). Solo cuentan los que
   siguen vigentes; una empresa cumple si cada uno le fue entregado alguna vez **en su versión vigente**
   (en cualquier entrega, no solo la última), y si no, el motivo «Falta entregar la información del
   centro: …» entra en `caeStatus` y en el filtro de las listas (también para la contrata de una
   subcontrata). Aplica a todos los tipos de empresa. Entregas: `GET/POST /companies/:id/info/deliveries`,
   `GET /companies/:id/info`, constancia en `GET /info/deliveries/:id/pdf`; auditoría
   `cae.info.update|deliver|export`. Permisos: `GET/POST /permits`, `GET/PATCH /permits/:id` (solo en
   borrador), `POST /permits/:id/approve` (firma y todas las medidas marcadas; vuelve a comprobar que cada
   trabajador esté autorizado), `/close`, `/cancel`, `/pdf`; auditoría `cae.permit.*`. Duración máxima,
   personas y medidas en `caeLimits` (`packages/limits`); las medidas por defecto de cada tipo, en el i18n
   de la app (es, latam y en). Los permisos sirven también para el personal propio: están en la pestaña de
   la CAE y solo existen con la CAE activada. Simplificaciones: emitir, aprobar, cerrar y anular es
   `cae.manage` (sin una capacidad `cae.permits` aparte) y quien emite puede aprobar; `cae.check` los lee;
   los trabajadores de un permiso son de la empresa del permiso; un permiso aprobado pasa a «Vencido»
   solo en la vista (no hay job que lo cierre); la constancia de entrega lleva la firma si se firmó en
   pantalla.
5. **Portal de contratas** (hecha): que la contrata suba sus propios documentos con un acceso propio.
   Opción elegida por el mantenedor: **enlace con código**, como las salas de auditoría. Decisiones de
   seguridad:
   - `CaePortalAccess` por empresa (migración `cae_portal`): el código (12 caracteres de base32 de
     Crockford, ~60 bits, `cae-portal-codes.ts`) se muestra una sola vez y solo se guarda su hash ligado
     al acceso (`sha256(accessId:código)`, como `auditCodeHash`), comparado en tiempo constante. Uno
     activo por empresa (índice único parcial); dar uno nuevo revoca el anterior y termina sus sesiones.
     Duración, sesión, rotación, intentos y tamaño de archivo en `caeLimits` (`packages/limits`).
   - URL fuera de `/app`: `/contratas/:accessId` (app) y `/api/v1/contratas/:accessId` (API, antes de las
     rutas de empresa, como `/api/v1/auditor`). El enlace no lleva el código.
   - Entrar: límite por acceso y dirección (10 cada 15 min) y por dirección (30 cada 15 min); cada código
     incorrecto suma en el acceso y a los 10 seguidos se bloquea (hay que dar otro). Cualquier problema
     (acceso inexistente, revocado, vencido o bloqueado, empresa archivada, CAE o módulo apagados, quien lo
     dio ya no activo o sin `cae.manage`, código incorrecto) responde el mismo error genérico; la portada
     sin sesión solo dice si hay sesión (ni el nombre de la empresa).
   - Sesión: token aleatorio en una cookie httpOnly, SameSite=Strict, Secure en producción y con `path`
     del acceso (las mismas opciones que la del auditor); se crea después del código (un token previo se
     ignora: sin fijación), se reemplaza cada 15 minutos de uso (el anterior vale un minuto más), dura 4
     horas como mucho y nunca más que el acceso; «Salir» la termina (`endedAt`, no se borra). En cada
     pedido se revisa todo de nuevo.
   - Alcance: todo se lee y escribe con `forTenant` del workspace del acceso y con el contexto de quien
     lo dio (como la sala usa el de su creador), siempre para la empresa de la sesión: ningún id del
     pedido llega a otra empresa (sus trabajadores, requisitos, carpetas) ni a otro tenant. La
     información del centro sale por un endpoint propio que solo sirve los documentos elegidos (el PDF
     controlado, con `Content-Security-Policy: default-src 'none'`), nunca las URLs generales de archivos.
     De la empresa anfitriona solo se ve el nombre del responsable interno; los permisos, sin los nombres
     del personal propio.
   - Subidas: el flujo normal (reserva, PUT prefirmado al almacenamiento, `completeUpload` con tamaño,
     tipo real por sus bytes y los límites de la empresa), más estrecho: solo PDF, JPG o PNG y hasta
     `portalMaxFileMb`. `CaePortalUpload` ata cada subida (su id es el de la reserva) al acceso y al
     requisito: nada más se puede completar desde el portal. Quedan PENDING en la carpeta de la empresa o
     del trabajador.
   - Autoría: lo que crea el portal se audita sin actor (`actorId` nulo) con `via: cae-portal` y el
     nombre de la empresa (`cae.portal.login`, `.login.failure` sin el código, `.document.upload`,
     `.worker.create|update|archive`, `.info.view`, y `cae.portal.issue|revoke` del lado del anfitrión);
     los documentos llevan `portalAccessId` («Subido por la contrata») y su `createdById` es quien dio el
     acceso, que responde por él. El responsable interno recibe el aviso `cae_portal_upload` en la campana.
   - No se relajó CSP, CORS ni los límites: la página del portal es una ruta más de la app.
   Simplificaciones: el email del acceso solo se guarda (no se envía el enlace); el PDF de la información
   lleva la marca de agua de quien dio el acceso; el responsable interno sin `cae.manage` no gestiona el
   acceso.

6. Ejemplos del sector alimentario, guías es/en, capturas y versión (hecha, salvo la versión).
   Con «Cargar ejemplos del sector alimentario» junto al interruptor de la CAE (`examples` con `cae: true`
   en `PUT /admin/safety`; solo carga los de la CAE, no los del módulo) se suman al catálogo, sin pisar
   nombres: formación en manipulación de alimentos (trabajador, contratas), normas de higiene y BPF del
   centro recibidas (trabajador, todas) y el certificado de la empresa de control de plagas (ROESB en
   España; empresa, contratas, **opcional**, porque solo lo tiene la de plagas). Nunca crea empresas
   externas en una instalación real. Datos de demo: `web/scripts/demo-cae.ts` (por la API, con PDF
   pequeños subidos con el flujo normal): cuatro contratas y una subcontrata con documentos en todos los
   estados, información entregada, dos permisos y accesos de hoy; lo usan `capturas.ts` (su base
   `*_capturas`) y un script local para la base de desarrollo. Capturas `cae-*` (la portería, a 375 px) en
   la guía de Seguridad y salud laboral. La versión la publica quien mantiene el proyecto, con la suite
   completa en verde.

Cada fase: commit propio y guías es/en de las pantallas que cambian. Tests de permisos y de aislamiento
entre empresas: todos juntos al cerrar el módulo (CLAUDE.md, «Pruebas»).
