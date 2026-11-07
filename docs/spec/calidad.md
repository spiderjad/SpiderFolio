# Calidad alimentaria

Núcleo, abierto y gratis (decidido con el mantenedor el 07/11/2026), como Prevención y la CAE: apagado por
defecto y activable por empresa. Es un **área propia** de la barra («Calidad», docs/spec/diseno.md 10.4.1),
no una pestaña de Prevención. Pensado primero para la industria cárnica; las normas que se auditan hoy son
**IFS Food versión 8** y **BRCGS Food Safety Issue 9**, más lo que revisa la inspección sanitaria oficial.
Notas de origen y los 14 bloques: `docs/plans/2026-11-07-modulo-calidad.md`.

Se apoya en lo que ya existe: documentos controlados (con su revisión y aprobación), formularios periódicos
con `min`/`max` y respuestas no conformes (`answers.ts`, aviso `form_nonconforming`), vencimientos (motor
`registerExpiryKind`), QR, salas de auditoría, Mis pendientes y el patrón de Prevención (caso → medidas con
responsable, fecha y cierre). Las integraciones con terceros (SAP, ADA MES) van como plugin.

Estado: **fase 1 hecha** (07/11/2026; spec aprobada por el mantenedor el mismo día). Detalle de lo hecho y
sus simplificaciones al final de «Fase 1».

## Activación

- Se activa en **Administración › Seguridad › General**, en una tarjeta propia «Calidad alimentaria» debajo
  de «Seguridad y salud laboral». Solo el propietario. `GET/PUT /admin/quality`. Se guarda en
  `Workspace.settings.quality` = `{ enabled, spaceId?, standards, verifyDays, examples? }`.
  - `standards`: las normas que la empresa audita (`IFS8`, `BRCGS9`, ninguna o las dos). Solo cambia textos
    de ayuda y, desde la fase 3, la lista de cláusulas que se ofrecen en los hallazgos. No limita nada.
  - `verifyDays`: días entre la última acción hecha y la verificación de eficacia propuesta (por defecto 30;
    el rango lo fija `packages/limits`).
- La **primera** activación crea, una sola vez:
  - el espacio de la empresa «Calidad» (`Space.area = QUALITY`, su id en `settings.quality.spaceId`; si se
    borra, la siguiente activación crea otro), visible para toda la empresa salvo que se cambie;
  - con «Cargar ejemplos del sector cárnico» (opcional), los ejemplos de cada fase ya hecha (en la fase 2:
    formularios de vigilancia de PCC). Nunca pisa lo que la empresa ya tenga con el mismo nombre.
- Con el módulo activo aparece el área **Calidad** en la barra (hoy definida y oculta: `nav-areas.ts`), como
  opción de área de entrada y como «Área de la app» de un espacio.
- Desactivar oculta el área, las pantallas y los avisos (los vencimientos `quality.*` quedan en pausa).
  **Nunca borra datos.** Con el módulo apagado, toda la API `/quality` responde 404.
- Auditoría: `quality.enable`, `quality.disable`, `quality.settings`.

## Permisos

- **`quality.manage`**: todo el módulo: no conformidades de cualquier origen, sus análisis, acciones,
  verificación y cierre; ajustes del módulo. Por defecto, propietario y Administrador (la migración la suma a
  los roles de sistema existentes, como `cae.manage`).
- **`quality.view`**: leer todas las no conformidades y acciones, sin cambiar nada. Para dirección o quien
  prepara una auditoría. Nadie la tiene por defecto salvo quien tiene `quality.manage`.
- **Cualquier persona** puede **comunicar** una no conformidad (también desde un QR, como un accidente): la
  ve después, sin poder cambiarla.
- El **responsable** de una no conformidad (una persona elegida por `quality.manage`) la ve y la gestiona
  aunque no tenga capacidades: análisis, acciones y propuesta de cierre; **cerrarla** exige
  `quality.manage`.
- El **responsable de una acción** ve la acción y el título de su no conformidad, y la marca como hecha
  (desde **Mis pendientes**, como las medidas de Prevención).
- Jefes y subjefes ven las no conformidades asignadas a su departamento (y subdepartamentos), solo para
  leer.
- Sin datos de salud. Una reclamación de un consumidor (fase 6) sí puede tener datos personales: se tratan
  entonces.
- Todo se valida en el backend; un recurso de otra empresa responde 404. Tests de permisos y de aislamiento
  entre empresas al cerrar el módulo (CLAUDE.md, «Pruebas»).

## Fase 1: no conformidades y CAPA

La columna del módulo: auditorías, reclamaciones, proveedores, PCC fuera de límite y el panel terminan en
una no conformidad (NC) con su CAPA (acciones correctivas y preventivas).

### Ciclo de vida

```
ABIERTA → EN ANÁLISIS → CON ACCIONES → EN VERIFICACIÓN → CERRADA
   └──────────────── ANULADA (con motivo, desde cualquier estado antes de cerrar)
```

1. **Abierta**: alguien la comunica o la crea `quality.manage`. Lleva qué pasó, dónde, cuándo, el origen y,
   si hubo, la **corrección inmediata** (lo que se hizo en el momento: separar el producto, recalibrar).
2. **En análisis**: el responsable busca la **causa raíz** con **5 porqués** (hasta 7 líneas) o **Ishikawa**
   (las 6M: mano de obra, método, máquina, material, medición, medio ambiente; texto por rama), y escribe la
   conclusión.
3. **Con acciones**: acciones de tipo **corrección**, **correctiva** o **preventiva**, cada una con
   responsable, fecha límite y descripción. Pasa sola a este estado con la primera acción.
4. **En verificación**: cuando todas las acciones están hechas, se propone la **fecha de verificación**
   (hoy + `verifyDays`, editable). Ese día el responsable de la NC recibe el aviso.
5. **Cerrada**: `quality.manage` registra si **fue eficaz** con una nota. Si no lo fue, la NC vuelve a
   **Con acciones** (con el registro de la verificación fallida) para sumar acciones nuevas. **Reabrir** una
   cerrada vuelve a **Con acciones**, con motivo.

Cada paso queda en el **historial** de la NC (quién, cuándo, qué cambió).

### Origen y gravedad

- **Origen**: `INTERNAL` (detectada en planta), `CCP` (PCC o registro fuera de límite), `AUDIT_INTERNAL`,
  `AUDIT_EXTERNAL` (IFS, BRCGS, cliente, inspección oficial), `COMPLAINT` (reclamación), `SUPPLIER`
  (proveedor o materia prima), `OTHER`. Con origen `CCP` desde un registro, queda el enlace al registro.
- **Gravedad**: `MINOR`, `MAJOR`, `CRITICAL` (las tres de BRCGS; IFS usa también «Mayor» y el KO, que se
  carga como crítica). La gravedad ordena las listas y, desde la fase 6, el panel.

### Modelo

- `QualityNc` `{ id, workspaceId, number (correlativo por empresa y año), year, title (1 a 160),
  description (hasta 4000), origin, severity, detectedOn (DATE), location? (hasta 120), departmentId?
  (el que la tiene asignada), recordId? (el registro de formulario que la originó; sin FK, los registros no
  se borran), fieldIds[] (los campos fuera de límite de ese registro), productAffected (bool), productNote?
  (lotes y cantidad, texto libre hasta que exista trazabilidad), correction? (la corrección inmediata),
  causeMethod? (FIVE_WHYS | ISHIKAWA | OTHER), causeAnalysis? (JSON validado con Zod según el método),
  rootCause? (la conclusión), status, ownerId (membership, el responsable), verifyOn? (DATE), cancelReason?,
  reportedById, createdAt, updatedAt, closedAt?, closedById? }`. Código visible **NC-2026-0001**
  (`number` con 4 dígitos; único `(workspaceId, year, number)`, asignado en la misma transacción con un
  contador por empresa y año para no repetir números con altas simultáneas).
- `QualityAction` `{ id, workspaceId, ncId, kind (CORRECTION | CORRECTIVE | PREVENTIVE), description (1 a
  1000), responsibleId, dueOn (DATE), doneAt?, doneById?, note?, createdById, createdAt }`. Vencimiento
  `quality.action` (avisos 7 días antes, el día anterior y el mismo día, como `safety.action`); hecha,
  resuelve el aviso.
- `QualityVerification` `{ id, workspaceId, ncId, effective (bool), note (1 a 2000), verifiedById,
  verifiedAt }`: solo se agrega. La última eficaz es la que cierra.
- `QualityNcEvent` `{ id, workspaceId, ncId, kind, actorId?, data (JSON), at }`: el historial (solo se
  agrega, nunca se borra). Aparte del registro de auditoría general, que lleva lo mismo.
- **Evidencias**: archivos del espacio de Calidad. Cada NC tiene su carpeta «NC-2026-0001 · título» dentro
  de «No conformidades», creada por el sistema con su primera evidencia (como las carpetas de la CAE). Quien
  no tiene acceso a la carpeta no ve el archivo, aunque vea la NC.
- Vencimiento `quality.verification` con `verifyOn` (al responsable de la NC; lo resuelve el cierre o la
  anulación).

### Desde un registro de formulario

- En un registro con respuestas **no conformes** de un formulario de cualquier área, **Abrir no
  conformidad** (para `quality.manage` o el responsable del formulario) crea la NC con origen `CCP`, el
  registro enlazado, los campos fuera de límite y la fecha del registro. Un registro tiene como mucho una NC
  abierta: si ya la tiene, el botón lleva a ella.
- **Apertura automática** (por formulario, en sus ajustes, solo con el módulo activo): «Abrir una no
  conformidad cuando un registro no sea conforme», con la gravedad por defecto y el responsable (por defecto,
  el primer responsable del formulario). Se crea al guardar el registro, en la misma transacción, y avisa al
  responsable (`quality_nc`). Es la que usan los registros de PCC de la fase 2.
- Convive con **Crear medida preventiva** de Prevención: un registro de una inspección de seguridad sigue
  yendo a la planificación; uno de un PCC, a Calidad. Un mismo registro puede tener las dos.

### Avisos

- `quality_nc`: NC nueva o asignada, al responsable (y, si la comunicó alguien sin capacidad, a quienes
  tienen `quality.manage`). El email no lleva la descripción, solo el código, el título y el enlace.
- `quality.action` y `quality.verification`: con el motor de vencimientos, en la campana, por email y en
  **Mis pendientes**.
- Al cerrar o anular, aviso a quien la comunicó.

### API (todo bajo `/api/v1/w/:slug/quality`, con el módulo activo)

- `GET/PUT /admin/quality`.
- NC: `GET /ncs` (cursor; `q` por código o título, `status`, `origin`, `severity`, `ownerId`,
  `departmentId`, `from`/`to`; orden por fecha o gravedad con `id` de desempate), `POST /ncs`,
  `GET /ncs/:id`, `PATCH /ncs/:id` (datos, análisis, responsable), `POST /ncs/:id/cancel` `{ reason }`,
  `POST /ncs/:id/reopen` `{ reason }`, `GET /ncs/:id/events`, `GET /ncs/export` (CSV de lo filtrado).
- Comunicar: `POST /ncs/report` (cualquier miembro: título, descripción, lugar, fecha, fotos), `GET /ncs/mine`.
- Acciones: `POST /ncs/:id/actions`, `PATCH /actions/:id`, `POST /actions/:id/done` `{ note? }`,
  `GET /actions` (todas, cursor, `status` = open | overdue | done, `responsibleId`, `kind`).
- Verificación: `PUT /ncs/:id/verify-on` `{ date }`, `POST /ncs/:id/verifications` `{ effective, note }`.
- Desde un registro: `POST /ncs/from-record` `{ recordId }` y, en los ajustes del formulario,
  `quality: { autoNc, severity, ownerId? }`.
- Evidencias: `POST /ncs/:id/folder` (devuelve la carpeta, la crea si falta) y el flujo normal de subida.
- Listas con la regla de paginación del proyecto; filtros y orden en la URL.

### Pantallas (`/app/:slug/calidad…`)

- Menú del área **Calidad**: **Resumen**, **No conformidades**, **Acciones**, **Comunicar una no
  conformidad**, y debajo los formularios y documentos de los espacios del área.
- **Resumen** (fase 1, mínimo): NC abiertas por gravedad, acciones vencidas, verificaciones de hoy y las
  últimas NC. El panel completo es la fase 6.
- **No conformidades**: tabla con código, título, origen, gravedad (pastilla), estado, responsable y
  antigüedad; filtros en la URL; **Exportar CSV**.
- **Ficha de la NC**: cabecera con código, estado y gravedad; pasos del ciclo como una línea de tiempo
  (Abierta → … → Cerrada) con el actual resaltado; secciones Descripción, Producto afectado, Corrección
  inmediata, Causa raíz (5 porqués o Ishikawa), Acciones, Verificación, Evidencias e Historial.
- **Acciones**: todas las acciones con su NC, filtrables; la propia en Mis pendientes.
- **Comunicar**: formulario corto (título, qué pasó, dónde, cuándo, fotos), también por QR.

### Hecho (fase 1)

- Migración `quality_nonconformities`: `QualityNc`, `QualityNcCounter` (número por empresa y año con
  `upsert`; el índice único `(workspaceId, year, number)` impide repetir), `QualityAction`,
  `QualityVerification` y `QualityNcEvent` (los dos últimos solo se agregan), y en `FormSettings`
  `qualityAutoNc`, `qualitySeverity` y `qualityOwnerId`. Suma `quality.manage` y `quality.view` a los roles
  de sistema propietario y Administrador existentes.
- Backend en `backend/src/modules/quality/` (acceso, ajustes, NC y CAPA, vencimientos `quality.action` y
  `quality.verification`, ajustes de calidad del formulario, rutas). Aviso `quality_nc` en la campana.
  `/auth/me` devuelve `workspace.quality.enabled`. Quien tiene `quality.manage` puede listar los
  departamentos (`/admin/departments/options`) para asignar una NC.
- App: área **Calidad** en la barra (`nav-areas.ts`), pantallas en `frontend/src/features/quality/`
  (`/calidad/resumen`, `/no-conformidades`, `/no-conformidades/:id`, `/acciones`, `/mis-acciones`,
  `/comunicadas`, `/comunicar`), tarjeta en Administración › Seguridad › General, tarjeta **Calidad** en los
  ajustes de cada formulario, botón en el registro y tarjeta en **Mis pendientes**.
- Demo y capturas: `web/scripts/demo-quality.ts` (un control de cámaras cuyo registro a 6,4 °C abre su NC
  sola, NC en cada paso y una comunicada) y las capturas `calidad-*` en las guías **Calidad** y **No
  conformidades y CAPA** (es y en).

Simplificaciones respecto de lo de arriba:

- `quality_nc` solo va a la campana (sin email); las acciones y la verificación sí avisan por email, como
  todo vencimiento.
- El responsable de una acción ve la NC entera en solo lectura (no solo el título): necesita el contexto.
- La apertura automática corre después de guardar el registro, fuera de su transacción: si falla, el
  registro queda y el fallo se anota en el log; se puede abrir a mano.
- Los ajustes de calidad del formulario tienen su propio endpoint (`GET/PUT /quality/forms/:id`, con EDIT
  sobre el formulario), no van dentro de `/forms/:id/settings`.
- Una NC comunicada queda `INTERNAL` y `MAJOR`, a cargo del propietario (o del primer `quality.manage`)
  hasta que alguien la asigne.
- El **Resumen** responde a cualquiera con lo que ve; en el menú solo aparece para `quality.view`.
- El texto de una NC abierta desde un registro se escribe en el idioma de la empresa.
- Tests de seguridad de la fase 1 (07/11/2026): `tests/integration/quality-security.test.ts` (módulo
  apagado, solo el propietario lo activa, cada rol, el ciclo, otra empresa y la apertura desde registros) y
  las rutas `/quality/*` en `tenant-isolation.test.ts`.

### Fuera de la fase 1

- Bloqueo del lote y decisión sobre el producto (reproceso, otro destino, SANDACH, liberación firmada): fase
  2, con los PCC.
- Bian, el conector MCP y la búsqueda general no ven las NC (sí sus archivos, como cualquier archivo).
- Sin plazos máximos de cierre por gravedad ni escalados automáticos.

## Fase 2: APPCC y registros de PCC

El plan APPCC (HACCP) es el corazón de IFS y BRCGS: los peligros de cada paso, los **puntos de control
crítico** (PCC) con su límite, cómo se vigilan, qué se hace si se pasa el límite y cómo se verifica. La
fase 2 lo lleva a la app sin reinventar lo que ya existe: el plan es un documento controlado, la
vigilancia son formularios periódicos con mínimo y máximo, y un valor fuera de límite abre su no
conformidad (fase 1).

### El plan APPCC

- Al activar el módulo (y, en una empresa que ya lo tenía, al guardar sus ajustes o abrir el plan) se crea
  el tipo de documento controlado **APPCC** «Plan APPCC» (revisión cada 12 meses), si no existe. Cada
  versión del plan es una versión de ese documento, con su aprobación (el equipo APPCC aprueba).
- El **cuadro de gestión de PCC** es una lista propia del módulo (`QualityCcp`), no un texto del plan: así
  cada PCC se enlaza con su formulario de vigilancia y se ve su estado.

### PCC

- `QualityCcp` `{ id, workspaceId, code (PCC-1, único por empresa), name (1 a 120), step (el paso del
  diagrama: «Cocción»), hazard (el peligro, hasta 500), hazardType (BIOLOGICAL | CHEMICAL | PHYSICAL |
  ALLERGEN), criticalLimit (texto: «≥ 72 °C en el centro del producto», hasta 300), formId? (el formulario
  de vigilancia; sin FK), frequency (texto: «cada lote», hasta 120), responsibleId? (membership),
  correctiveAction (hasta 1000), verification (hasta 1000), position, archivedAt?, createdAt, updatedAt }`.
  Se archiva, no se borra.
- Pantalla **Plan APPCC** (`/calidad/appcc`): el enlace al documento vigente del plan y el cuadro de PCC
  (código, paso, peligro, límite crítico, vigilancia, responsable), con, por PCC, los registros de los
  últimos 30 días, cuántos fuera de límite y sus NC abiertas. **Nuevo PCC**, editar, ordenar y archivar
  (quality.manage). Quien tiene `quality.view` lo lee.
- Cada PCC con formulario muestra su **QR** (el del formulario, que ya existe): pegado en la línea, abre
  el registro y la instrucción vigente.

### Plantilla cárnica

En la tarjeta del módulo, **Cargar la plantilla cárnica** crea, una sola vez y sin pisar nombres:

- la carpeta **Registros de vigilancia (PCC)** en el espacio Calidad con seis formularios periódicos
  (diarios de lunes a viernes) con sus campos, límites y apertura automática de NC: **Recepción de
  materia prima** (temperatura ≤ 7 °C en carne fresca, estado, lote de origen, registro sanitario del
  matadero), **Temperatura de cámaras** (0 a 4 °C), **Curva de secaderos** (temperatura, humedad
  relativa, aw ≤ 0,92 y pH ≤ 5,3 al salir), **Cocción** (≥ 72 °C en el centro), **Enfriamiento** (≤ 4 °C
  antes de 6 horas) y **Detector de metales** (piezas patrón Fe 2,0 mm, no Fe 2,5 mm y acero inoxidable
  3,0 mm detectadas; si no, NC **crítica**);
- seis PCC en el cuadro, cada uno enlazado con su formulario.

Los límites son ejemplos habituales del sector: la empresa los ajusta a su plan.

### Producto retenido

- `QualityHold` `{ id, workspaceId, ncId? (sin FK compuesta obligatoria: también puede retenerse sin NC),
  product (1 a 160), lot (hasta 120), quantity (texto: «640 kg», hasta 60), location? (hasta 120),
  status (HELD | RELEASED | REWORKED | DIVERTED | DESTROYED), reason (hasta 1000), decisionNote?,
  decidedById?, decidedAt?, signature? (PNG de quien decide), createdById, createdAt }`.
- **Retener producto** desde la ficha de una NC (o suelto, desde la lista): queda **Retenido**.
- **Decidir**: liberar, reprocesar, otro destino (por ejemplo, a cocido) o destruir / SANDACH (Reglamento
  1069/2009), con una nota y la **firma** en pantalla de quien decide (quality.manage). La decisión no se
  cambia ni se borra; queda en el historial de la NC.
- Pantalla **Producto retenido** (`/calidad/retenido`): lo retenido primero, filtrable por estado.
- El retenido de una NC se ve en su ficha.

### Hecho (fase 2)

Hecha el 07/11/2026. Migración `quality_haccp_holds` (`QualityCcp`, `QualityHold`). Backend en
`haccp.service.ts`, `haccp-template.ts`, `haccp.schemas.ts` y `holds.service.ts`; pantallas **Plan APPCC**
(`/calidad/appcc`) y **Producto retenido** (`/calidad/retenido`), tarjeta de retenido en la ficha de la NC y
botón de la plantilla en la tarjeta del módulo. Demo en `web/scripts/demo-quality.ts` (`demoHaccp`), capturas
`calidad-appcc` y `calidad-retenido`, guía **Plan APPCC y producto retenido** (es y en) y tests de seguridad
en `quality-security.test.ts` y `tenant-isolation.test.ts`.

Simplificaciones:

- La plantilla no fija la frecuencia ni quién llena cada formulario (un formulario periódico necesita a
  quién se le pide): se eligen en sus ajustes. Sus formularios quedan con apertura automática de NC.
- El formulario de un PCC se elige entre los de los espacios del área Calidad (`GET /quality/ccps/form-options`,
  solo quality.manage, solo nombres).
- La firma de la decisión se guarda (PNG) y la pantalla dice «Firmado», sin mostrar la imagen.
- Las NC abiertas por PCC se cuentan entre las 2000 abiertas más recientes con registro.
- Una NC cerrada o anulada no admite retener producto nuevo.

### API (fase 2)

- `GET/POST /quality/ccps`, `PATCH /quality/ccps/:id`, `POST /quality/ccps/:id/archive`,
  `PUT /quality/ccps/order`, `GET /quality/haccp` (el plan vigente y el cuadro con sus números).
- `POST /admin/quality/template` (la plantilla cárnica; solo el propietario, con el módulo activo).
- `GET/POST /quality/holds`, `GET /quality/holds/:id`, `POST /quality/holds/:id/decision`
  `{ status, note, signature }`.
- Auditoría: `quality.ccp.create|update|archive|order`, `quality.template`, `quality.hold.create`,
  `quality.hold.decide`.


## Fase 3: auditorías

IFS 8 y BRCGS 9 piden un **programa anual de auditorías internas** que cubra toda la norma, y que cada
hallazgo (interno o externo) tenga su corrección y su acción correctiva con evidencia. La fase 3 junta las
auditorías en un programa, sus hallazgos por cláusula y la NC de cada uno.

### Auditorías

- `QualityAudit` `{ id, workspaceId, scheme (INTERNAL | IFS8 | BRCGS9 | CLIENT | OFFICIAL | OTHER), title (1
  a 160), scope (hasta 2000), plannedOn (DATE), doneOn? (DATE), auditor (texto: quién audita, hasta 160),
  leadId? (membership: quien la lleva en la empresa), chapters[] (los capítulos de la norma que cubre una
  interna), status (PLANNED | DONE | CANCELLED), result? (hasta 300: «Nivel superior, 96,3 %»), auditRoomId?
  (una sala de auditoría para el auditor externo; sin FK), cancelReason?, createdById, createdAt,
  updatedAt }`. Se anula, no se borra.
- `INTERNAL` es interna; las demás, externas (IFS, BRCGS, de un cliente, la inspección oficial u otra).
- Vencimiento `quality.audit` con `plannedOn` a quien la lleva (o a quien la creó): 7 días antes, el día
  anterior y el mismo día; lo resuelve el cierre o la anulación.
- **Cerrar** (DONE) pide la fecha en que se hizo y, si quiere, el resultado.

### Hallazgos

- `QualityFinding` `{ id, workspaceId, auditId, clause (hasta 40: «4.12.1»), description (1 a 2000), severity
  (MINOR | MAJOR | CRITICAL; el KO de IFS va como crítico), ncId?, createdById, createdAt }`. Solo se agregan
  y se les puede abrir la NC; no se borran.
- **Abrir no conformidad** al registrarlo (marcado por defecto) o después: la NC lleva origen
  `AUDIT_INTERNAL` o `AUDIT_EXTERNAL` según la auditoría, la gravedad del hallazgo, el título «Cláusula
  4.12.1: …», la fecha de la auditoría y el responsable que se elija (por defecto, quien lleva la auditoría).
  La ficha de la NC enlaza su auditoría.

### Programa y cobertura

- Pantalla **Auditorías** (`/calidad/auditorias`): el año elegido, sus auditorías por fecha con su tipo,
  estado, hallazgos y NC abiertas; **Nueva auditoría**.
- **Cobertura del programa interno**: por cada norma que la empresa audita (`settings.quality.standards`),
  sus capítulos y si alguna auditoría interna **hecha** del año los cubrió. IFS Food 8: 1 Gobernanza y
  compromiso, 2 Sistema de gestión, 3 Gestión de recursos, 4 Planificación y producción, 5 Mediciones,
  análisis y mejoras, 6 Food defense. BRCGS 9: 1 Compromiso de la dirección, 2 Plan APPCC, 3 Sistema de
  gestión, 4 Normas del establecimiento, 5 Control del producto, 6 Control de procesos, 7 Personal, 8 Zonas
  de producción de riesgo, 9 Productos comercializados. Sin normas elegidas, no se muestra.
- Ficha de la auditoría (`/calidad/auditorias/:id`): datos, la sala de auditoría enlazada, los hallazgos con
  su cláusula, gravedad y NC (con su estado) y **Agregar hallazgo**.

### Permisos

- quality.manage crea, edita, cierra y anula auditorías y registra hallazgos; quality.view lo lee.
- Quien **lleva** una auditoría (leadId) la ve aunque no tenga capacidades, registra sus hallazgos y la
  cierra.
- Enlazar una sala exige verla (la creó o es el propietario, como en las salas).

### Hecho (fase 3)

Hecha el 07/11/2026. Migración `quality_audits` (`QualityAudit`, `QualityFinding`). Backend en
`audits.service.ts` y `audits.schemas.ts`, vencimiento `quality.audit`; pantallas **Auditorías**
(`/calidad/auditorias`, con la cobertura) y la ficha de cada una; la ficha de la NC enlaza su auditoría.
Demo (`demoAudits`), capturas `calidad-auditorias` y `calidad-auditoria`, guía **Auditorías** (es y en) y
tests de seguridad.

Simplificaciones:

- Una auditoría hecha sigue recibiendo hallazgos (el informe externo suele llegar días después); ya no se
  edita.
- La sala se elige entre las que la persona ve (las suyas, o todas para el propietario) y solo en las
  externas; la ficha la enlaza para quien tiene `audit.share`.
- Sin normas elegidas en los ajustes, no hay cobertura ni capítulos para elegir.
- El responsable de la NC de un hallazgo es el elegido, quien lleva la auditoría o quien lo registra.

### API (fase 3)

- `GET /quality/audits?year&status`, `POST /quality/audits`, `GET /quality/audits/:id`,
  `PATCH /quality/audits/:id`, `POST /quality/audits/:id/done` `{ doneOn, result? }`,
  `POST /quality/audits/:id/cancel` `{ reason }`, `GET /quality/audits/coverage?year`.
- `POST /quality/audits/:id/findings` `{ clause, description, severity, openNc, ownerId? }`,
  `POST /quality/findings/:id/nc` `{ ownerId? }`.
- Auditoría: `quality.audit.create|update|done|cancel`, `quality.finding.create`, y la NC como siempre.


## Fases

1. **No conformidades y CAPA** (arriba): activación, permisos, NC con su ciclo, causa raíz, acciones,
   verificación de eficacia, evidencias, apertura desde un registro (manual y automática), avisos, listas y
   guías es/en.
2. **APPCC y registros de PCC** (bloques 1 y 2, detalle arriba): plan APPCC como documento controlado,
   cuadro de PCC enlazado con sus formularios, plantilla cárnica y producto retenido con su decisión
   firmada.
3. **Auditorías** (bloque 11, detalle arriba): programa anual con su cobertura por capítulo, externas con
   su sala de auditoría, hallazgos por cláusula que abren su NC.
4. **Proveedores** (bloque 8): homologación, fichas técnicas, certificados IFS/BRCGS con vencimiento,
   evaluación anual, materias de riesgo, vulnerabilidad al fraude y food defense.
5. **Reclamaciones y retirada** (bloques 6 y 7): registro con plazo de respuesta y NC; indicador por millón
   de unidades; equipo de crisis, contactos, plantillas y simulacros de retirada.
6. **Panel de indicadores** (bloque 14) y el resto (bloques 3, 9, 10, 12 y 13): prerrequisitos,
   especificaciones y etiquetado, plan analítico, cultura de seguridad alimentaria y gestión de cambios.
7. **Trazabilidad** (bloque 4): al final, con el conector de SAP y ADA MES (plugin).

Cada fase: commit propio, guías es/en de las pantallas que cambian y capturas. Tests de permisos y de
aislamiento entre empresas: todos juntos al cerrar el módulo.

## Decisiones tomadas en esta spec (a confirmar por el mantenedor)

1. Interruptor en **Administración › Seguridad › General**, junto al de Prevención, solo el propietario.
2. Dos capacidades: `quality.manage` y `quality.view`; cualquiera comunica.
3. Gravedad en tres niveles (menor, mayor, crítica); el KO de IFS se carga como crítica.
4. Código **NC-AAAA-NNNN**, correlativo por año.
5. Verificación de eficacia a los **30 días** de la última acción hecha, editable por la empresa.
6. Modelo propio (`QualityAction`), no las medidas de Prevención (`SafetyAction`): el ciclo con
   verificación de eficacia y los tipos corrección / correctiva / preventiva son distintos. La pantalla de
   acciones reutiliza los componentes.
