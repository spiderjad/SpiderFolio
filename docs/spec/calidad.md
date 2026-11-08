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


## Fase 4: proveedores

IFS 8 (4.4 y 4.5) y BRCGS 9 (3.5) piden homologar a los proveedores según el riesgo de lo que suministran,
tener sus certificados y fichas técnicas vigentes, evaluarlos cada año y valorar la vulnerabilidad al fraude
de cada materia prima (IFS 4.21; BRCGS 5.4). La fase 4 los reúne en un registro con sus documentos y
vencimientos, su evaluación anual y sus no conformidades.

### Proveedores

- `QualitySupplier` `{ id, workspaceId, name (1 a 160, único sin distinguir mayúsculas), nameKey, taxId?
  (hasta 20), category (RAW_MATERIAL | PACKAGING | INGREDIENT | SERVICE | OTHER), supplies (qué suministra,
  hasta 500), risk (LOW | MEDIUM | HIGH: el riesgo de lo que suministra), fraudRisk (LOW | MEDIUM | HIGH) y
  fraudNote? (la valoración de vulnerabilidad al fraude), contact? (hasta 300), ownerId? (membership, quien
  lo sigue), status (PENDING | APPROVED | CONDITIONAL | BLOCKED), nextReviewOn? (DATE), folderId?,
  archivedAt?, createdById, createdAt, updatedAt }`. Se archiva, no se borra.
- Un proveedor nuevo queda **Pendiente** hasta su primera evaluación.
- Cada uno tiene su carpeta «Proveedores/<nombre>» en el espacio Calidad, creada por el sistema la primera
  vez que se abre (como las de las NC).

### Documentos y vencimientos

- `QualitySupplierDoc` `{ id, workspaceId, supplierId, kind (CERT_IFS | CERT_BRCGS | CERT_OTHER | SPEC_SHEET |
  QUESTIONNAIRE | ANALYSIS | OTHER), name (1 a 160), nodeId? (un archivo de su carpeta), validUntil? (DATE),
  createdById, createdAt, archivedAt? }`. Se archivan, no se borran.
- Con `validUntil`, vencimiento `quality.supplier_doc` a quien sigue al proveedor (o a quien lo cargó): 30
  días antes, 7 y el mismo día. Archivar el documento lo resuelve.
- Estado de cada documento (calculado): **Vigente**, **Por vencer** (30 días o menos), **Vencido** o **Sin
  vencimiento**. La lista muestra el peor estado de los certificados de cada proveedor.

### Evaluación anual

- `QualitySupplierReview` `{ id, workspaceId, supplierId, reviewedOn (DATE), scores (JSON: calidad, servicio,
  documentación e incidencias, de 1 a 5), result (APPROVED | CONDITIONAL | BLOCKED), note (hasta 1000),
  reviewedById, createdAt }`. Solo se agregan.
- Registrar una evaluación pone el estado del proveedor y su **próxima evaluación** a los 12 meses (6 si es
  condicional); vencimiento `quality.supplier_review`.
- La ficha muestra las NC abiertas del proveedor del último año como dato para evaluar.

### No conformidades del proveedor

- `QualityNc.supplierId?`: una NC con origen `SUPPLIER` puede ligarse a un proveedor (desde su ficha,
  **Abrir no conformidad**). La ficha del proveedor lista las suyas y la de la NC enlaza al proveedor.

### Permisos

- quality.manage da de alta, edita, archiva, evalúa y carga documentos; quality.view lo lee.
- Quien sigue a un proveedor (ownerId) lo ve y carga sus documentos aunque no tenga capacidades; no lo
  evalúa.

### Pantallas

- **Proveedores** (`/calidad/proveedores`): buscador, filtros por estado, categoría y riesgo; columnas
  nombre, categoría, riesgo, estado, certificados (peor estado) y próxima evaluación.
- Ficha (`/calidad/proveedores/:id`): datos, riesgo y fraude, documentos con su estado y vencimiento,
  evaluaciones, NC, **Abrir la carpeta**.

### Hecho (fase 4)

Hecha el 07/11/2026. Migración `quality_suppliers` (`QualitySupplier`, `QualitySupplierDoc`,
`QualitySupplierReview` y `QualityNc.supplierId`). Backend en `suppliers.service.ts` y `suppliers.schemas.ts`,
vencimientos `quality.supplier_doc` y `quality.supplier_review`; pantallas **Proveedores**
(`/calidad/proveedores`) y la ficha de cada uno; la NC enlaza su proveedor y se abre desde la ficha. Demo
(`demoSuppliers`), capturas `calidad-proveedores` y `calidad-proveedor`, guía **Proveedores** (es y en) y tests
de seguridad.

Simplificaciones:

- Un documento apunta a un archivo de la carpeta del proveedor (se sube con el explorador y se elige); no hay
  subida desde la propia ficha.
- La evaluación es una puntuación de 1 a 5 en cuatro criterios fijos y un resultado elegido por quien evalúa
  (no se calcula de la puntuación).
- El estado de los certificados en la lista mira solo los certificados (no fichas ni analíticas).
- Un proveedor archivado no recibe documentos ni evaluaciones; se recupera desde su ficha.

### API (fase 4)

- `GET /quality/suppliers` (cursor, `q`, `status`, `category`, `risk`), `POST /quality/suppliers`,
  `GET/PATCH /quality/suppliers/:id`, `POST /quality/suppliers/:id/archive`, `POST /quality/suppliers/:id/folder`,
  `GET /quality/suppliers/:id/files` (los archivos de su carpeta, para elegir).
- `POST /quality/suppliers/:id/docs`, `POST /quality/supplier-docs/:id/archive`.
- `POST /quality/suppliers/:id/reviews`.
- `POST /quality/ncs` acepta `supplierId` con origen `SUPPLIER`.
- Auditoría: `quality.supplier.create|update|archive`, `quality.supplier.doc`, `quality.supplier.review`.


## Fase 5: reclamaciones y retirada

IFS 8 (5.9 y 5.10) y BRCGS 9 (3.10 y 3.11) piden registrar y responder cada reclamación en plazo, analizar
sus tendencias, tener un procedimiento de gestión de incidentes y retirada con su equipo y sus contactos, y
probarlo al menos una vez al año.

### Reclamaciones

- `QualityComplaint` `{ id, workspaceId, source (CUSTOMER | CONSUMER | AUTHORITY), from (quién reclama:
  cliente o persona, hasta 160), contact? (hasta 300: el teléfono o el email; dato personal de un
  consumidor), product (1 a 160), lot? (hasta 120), category (FOREIGN_BODY | ALLERGEN | MICROBIOLOGICAL |
  QUALITY | LABELLING | PACKAGING | OTHER), description (1 a 4000), receivedOn (DATE), respondBy (DATE),
  respondedOn? (DATE), response? (hasta 4000), justified? (bool), status (OPEN | ANSWERED | CLOSED), ownerId
  (membership), ncId?, createdById, createdAt, updatedAt }`. Se cierra, no se borra.
- `respondBy` = `receivedOn` + `settings.quality.responseDays` (por defecto 10, editable en los ajustes del
  módulo y en cada reclamación). Vencimiento `quality.complaint` al responsable (7, 1 y 0 días); lo resuelve
  la respuesta.
- **Responder** pide la respuesta y si la reclamación era **justificada**; **Cerrar** la da por terminada.
  **Abrir no conformidad** la crea con origen `COMPLAINT`, la gravedad elegida y el producto y el lote en la
  descripción; la reclamación y la NC se enlazan.
- Los datos de contacto de un consumidor solo los ven quality.manage y el responsable.

### Indicador de reclamaciones

- `QualityMonthUnits` `{ workspaceId, month (DATE, día 1), units (entero) }`: las unidades vendidas de cada
  mes, que carga quality.manage.
- **Reclamaciones por millón de unidades** de los últimos 12 meses y del año, por mes, con el reparto por
  categoría; sin unidades cargadas se muestra solo el número de reclamaciones.

### Gestión de crisis y retirada

- **Equipo de crisis**: `QualityCrisisMember` `{ id, workspaceId, membershipId, role (hasta 120: «Coordinador»,
  «Comunicación»…), position }`.
- **Contactos de crisis**: `QualityCrisisContact` `{ id, workspaceId, kind (AUTHORITY | CUSTOMER | INSURER |
  LAB | SUPPLIER | OTHER), name (1 a 160), organization?, phone?, email?, notes?, position, archivedAt? }`.
- **Pruebas de retirada**: `QualityRecallTest` `{ id, workspaceId, kind (DRILL | REAL), date (DATE), product,
  lot, direction (BACKWARD | FORWARD | BOTH), minutes (cuánto tardó la trazabilidad), recoveredPercent? (0 a
  100), result (hasta 2000), ncId?, createdById, createdAt }`. Al año de la última prueba, quality.manage
  recibe el aviso (`quality.recall_test`, como los simulacros de emergencia).
- Las plantillas de comunicación (a la autoridad, a clientes) son documentos controlados del espacio Calidad:
  la pantalla enlaza a ese espacio.

### Permisos

- quality.manage gestiona todo; quality.view lee (sin el contacto de los consumidores).
- El responsable de una reclamación la ve y la responde aunque no tenga capacidades.
- Cualquiera de la empresa puede **registrar** una reclamación recibida (el comercial que la atiende): queda a
  cargo del propietario o del primer quality.manage, como una NC comunicada.

### Pantallas

- **Reclamaciones** (`/calidad/reclamaciones`): lista con filtros por estado, categoría, origen y fechas,
  vencidas en rojo; ficha con la respuesta, la NC y el plazo.
- **Indicadores de reclamaciones** dentro de la lista (pestaña) con las unidades de cada mes.
- **Crisis y retirada** (`/calidad/crisis`): el equipo, los contactos y las pruebas de retirada.

### Hecho (fase 5)

Hecha el 07/11/2026. Migración `quality_complaints_recall` (`QualityComplaint`, `QualityMonthUnits`,
`QualityCrisisMember`, `QualityCrisisContact`, `QualityRecallTest`) y `settings.quality.responseDays`. Backend
en `complaints.service.ts`, `crisis.service.ts` y `complaints.schemas.ts`, vencimientos `quality.complaint` y
`quality.recall_test`; pantallas **Reclamaciones** (con la pestaña **Indicadores**), su ficha y **Crisis y
retirada**. Demo (`demoComplaints`), capturas `calidad-reclamaciones`, `calidad-reclamaciones-indicadores` y
`calidad-crisis`, guía **Reclamaciones y retirada** (es y en) y tests de seguridad.

Simplificaciones:

- Las reclamaciones no tienen código correlativo (se identifican por quién reclama, el producto y la fecha).
- El aviso de la prueba anual de retirada va a quien registró la última.
- Las plantillas de comunicación son documentos del espacio Calidad; la pantalla solo lo enlaza.
- El indicador por millón cuenta solo los meses con unidades cargadas.
- Quien no tiene `quality.view` ve en el menú «Registrar una reclamación» y la lista con las suyas.

### API (fase 5)

- `GET/POST /quality/complaints`, `GET/PATCH /quality/complaints/:id`, `POST /quality/complaints/:id/answer`
  `{ response, justified, respondedOn }`, `POST /quality/complaints/:id/close`, `POST /quality/complaints/:id/nc`
  `{ severity, ownerId? }`, `GET /quality/complaints/indicators?year`, `PUT /quality/units` `{ month, units }`.
- `GET /quality/crisis`, `POST /quality/crisis/members`, `DELETE /quality/crisis/members/:id`,
  `POST /quality/crisis/contacts`, `PATCH /quality/crisis/contacts/:id`, `POST /quality/crisis/contacts/:id/archive`,
  `GET/POST /quality/recall-tests`.
- `settings.quality.responseDays` (1 a 90) en `PUT /admin/quality`.


## Fase 6a: panel y prerrequisitos

### Panel de indicadores

El **Resumen** del área pasa a ser el panel de calidad (para `quality.view`): en una pantalla, lo que pide
atención y cómo va el año.

- **No conformidades**: abiertas por gravedad, por origen, vencidas (alguna acción vencida), en verificación
  hoy y el tiempo medio de cierre de las cerradas en el año.
- **PCC**: registros de los últimos 30 días de los formularios del plan APPCC y cuántos fuera de límite, y el
  producto retenido sin decidir.
- **Proveedores**: certificados vencidos o por vencer y evaluaciones vencidas.
- **Reclamaciones**: abiertas, vencidas y por millón de unidades del año.
- **Auditorías**: las próximas 60 días y la cobertura del programa interno.
- **Prerrequisitos**: controles vencidos o por vencer y los no conformes de los últimos 30 días.
- Cada número lleva a su lista. `GET /quality/dashboard` lo calcula en una sola llamada.

### Prerrequisitos

Los programas de prerrequisitos (limpieza y desinfección, plagas, agua, mantenimiento y calibración, vidrio
y plástico duro, residuos y SANDACH) son controles periódicos con su responsable y su evidencia.

- `QualityPrp` `{ id, workspaceId, kind (CLEANING | PEST | WATER | CALIBRATION | GLASS | WASTE | OTHER), name
  (1 a 160: «Termómetro sonda T-03»), location? (hasta 120), everyDays (cada cuántos días, 1 a 730),
  responsibleId? (membership), formId? (un formulario donde se registra; sin FK), lastDoneOn? (DATE),
  nextDueOn (DATE), notes? (hasta 1000), archivedAt?, createdById, createdAt, updatedAt }`. Se archiva.
- `QualityPrpCheck` `{ id, workspaceId, prpId, doneOn (DATE), conforming (bool), note? (hasta 1000), ncId?,
  doneById, createdAt }`: solo se agregan.
- Registrar un control pone `lastDoneOn` y `nextDueOn = doneOn + everyDays`. No conforme: **Abrir no
  conformidad** (origen `INTERNAL`) en el mismo paso, con el nombre del control en el título.
- Vencimiento `quality.prp` con `nextDueOn` al responsable (o a quien lo creó): 7 días antes, el día anterior
  y el mismo día.
- Estado calculado: **Al día**, **Por vencer** (7 días o menos), **Vencido**.
- Pantalla **Prerrequisitos** (`/calidad/prerrequisitos`): por programa, cada control con su estado, último y
  próximo; **Nuevo control**, **Registrar** y el historial de cada uno.
- Permisos: quality.manage crea, edita y archiva; quien es responsable de un control y quality.manage
  registran; quality.view lee.
- API: `GET/POST /quality/prps`, `PATCH /quality/prps/:id`, `POST /quality/prps/:id/archive`,
  `GET /quality/prps/:id/checks`, `POST /quality/prps/:id/checks` `{ doneOn, conforming, note?, openNc,
  severity? }`, `GET /quality/dashboard`.

### Hecho (fase 6a)

Hecha el 07/11/2026. Migración `quality_prerequisites` (`QualityPrp`, `QualityPrpCheck`). Backend en
`prps.service.ts`, `prps.schemas.ts` y `dashboard.service.ts`, vencimiento `quality.prp`; pantalla
**Prerrequisitos** y el **Resumen** convertido en el panel. Demo (`demoPrps`), capturas
`calidad-prerrequisitos` y `calidad-resumen` (nueva), guía **Prerrequisitos** (es y en), la de **Calidad:
primeros pasos** actualizada y tests de seguridad.

Simplificaciones y añadidos:

- `POST /quality/prps/:id/restore` restaura un control archivado.
- Un control registrado con una fecha anterior al último no mueve la próxima fecha.
- Quien no tiene `quality.view` ve en **Lo mío** «Mis controles», con los controles a su cargo.
- Los invitados no entran (403) ni pueden ser responsables de un control.
- El tiempo medio de cierre cuenta las NC cerradas en los últimos 12 meses (no en el año natural).
- La NC de un control no conforme queda a cargo del responsable del control (o de quien lo registra).


## Fase 6b: productos, etiquetado y plan analítico

Bloques 9 y 10 de las notas. Mismo patrón que los prerrequisitos: controles periódicos con responsable,
vencimiento y no conformidad en el mismo paso.

### Productos y ficha técnica

El catálogo de lo que fabrica la empresa, con su ficha técnica (IFS 4.2, BRCGS 3.6 y 5.1). El documento
formal de la ficha sigue siendo un documento controlado; aquí van los datos que se revisan contra la etiqueta.

- `QualityProduct` `{ id, workspaceId, code? (hasta 40), name (1 a 160), family? (hasta 80), ingredients
  (hasta 4000, en orden de peso), allergens (QualityAllergen[]), mayContain (QualityAllergen[]: trazas por
  contaminación cruzada), nutrition? (Json, por 100 g: energyKj, energyKcal, fat, saturates, carbs, sugars,
  protein, salt), shelfLifeDays? (1 a 3650), storage? (hasta 200: «Entre 0 y 4 °C»), readyToEat (bool: listo
  para consumo, Reglamento 2073/2005), specNodeId? (la ficha como documento controlado; sin FK), folderId?,
  notes? (hasta 1000), specVersion (Int, empieza en 1), archivedAt?, createdById, createdAt, updatedAt }`.
  Se archiva.
- `QualityAllergen`: los 14 del anexo II del Reglamento 1169/2011 (GLUTEN, CRUSTACEANS, EGGS, FISH, PEANUTS,
  SOY, MILK, NUTS, CELERY, MUSTARD, SESAME, SULPHITES, LUPIN, MOLLUSCS).
- **`specVersion` sube** cuando cambian los ingredientes, los alérgenos, las trazas, la información
  nutricional o la vida útil. Es contra lo que se aprueba una etiqueta.
- Cada producto tiene su carpeta «Productos/<nombre>» en el espacio de Calidad, creada la primera vez que se
  necesita (como la de un proveedor): ahí van el arte de las etiquetas y los informes de vida útil.

### Estudios de vida útil

- `QualityShelfLifeStudy` `{ id, workspaceId, productId, startedOn (DATE), targetDays (1 a 3650), listeria
  (bool: incluye Listeria monocytogenes), result (PENDING | PASSED | FAILED), resultOn?, conclusion? (hasta
  1000), reportNodeId? (archivo de la carpeta del producto; sin FK), createdById, createdAt }`.
- Registrar el resultado (**Aprobado** o **No superado**) cierra el estudio; no superado puede abrir la NC
  (origen **Analítica**) en el mismo paso.
- Un producto **listo para consumo** sin estudio aprobado aparece como «Sin estudio de vida útil».

### Etiquetas

El circuito de aprobación de etiquetas contra el Reglamento 1169/2011 y la ficha vigente.

- `QualityLabel` `{ id, workspaceId, productId, version (correlativo por producto), nodeId? (el arte, archivo
  de la carpeta del producto; sin FK), status (IN_REVIEW | APPROVED | REJECTED | SUPERSEDED), specVersion
  (la versión de la ficha contra la que se revisa), checks (Json), note? (hasta 1000), submittedById,
  submittedAt, reviewedById?, reviewedAt?, reviewNote? (hasta 1000) }`.
- **Enviar a revisión** (quality.manage): la etiqueta queda En revisión con la versión actual de la ficha.
- **Revisar** (quality.manage): la lista de comprobación del artículo 9: denominación, lista de ingredientes,
  alérgenos destacados, cantidad neta, fecha de duración mínima o de caducidad, conservación, operador, lote,
  origen e información nutricional; en la pantalla se ven los alérgenos y la vida útil de la ficha al lado.
  **Aprobar** exige todo marcado (o «no aplica» en origen y nutricional); **Rechazar** exige el motivo.
  Aprobar una pasa la aprobada anterior a Sustituida. Si la aprueba quien la envió, queda registrado (no se
  impide: en una pyme puede haber una sola persona de calidad).
- Estado del etiquetado de cada producto: **Aprobada**, **Desactualizada** (la ficha cambió después:
  `specVersion` mayor que la de la etiqueta aprobada), **En revisión** o **Sin etiqueta**.

### Plan analítico

Muestreo de producto, superficies, ambiente y agua, con su criterio y el informe del laboratorio externo.

- `QualitySamplingPoint` `{ id, workspaceId, kind (PRODUCT | SURFACE | ENVIRONMENT | WATER), name (1 a 160:
  «Sumidero sala de loncheado»), productId?, zone? (hasta 120: «Zona 1, contacto»), parameter (1 a 120:
  «Listeria monocytogenes»), criterion? (hasta 200: «Ausencia en 25 g»), maxValue? (Float), unit? (hasta 20),
  everyDays (1 a 730), laboratory? (hasta 120), responsibleId?, lastSampledOn?, nextDueOn, archivedAt?,
  createdById, createdAt, updatedAt }`. Se archiva.
- `QualityLabResult` `{ id, workspaceId, pointId, sampledOn (DATE), value? (Float), detected? (bool),
  conforming (bool), reportNodeId? (archivo del espacio de Calidad; sin FK), note? (hasta 1000), ncId?,
  recordedById, createdAt }`: solo se agregan.
- **Registrar resultado**: el valor (o detectado / no detectado). La pantalla propone conforme o no conforme
  según el límite (`value ≤ maxValue`, no detectado) y la persona lo confirma. No conforme: **Abrir no
  conformidad** con el origen nuevo **Analítica** (`LAB`) y el punto y el parámetro en el título.
- Mueve la próxima fecha como un prerrequisito; vencimiento `quality.sampling` al responsable (o a quien lo
  creó): 7 días antes, el día anterior y el mismo día.
- **Tendencia**: el historial de cada punto muestra sus valores contra el límite; dos resultados no conformes
  seguidos en el mismo punto lo marcan **Repetido**.
- Los informes del laboratorio van en «Plan analítico» dentro del espacio de Calidad (carpeta creada la
  primera vez).

### Permisos

- Productos, estudios y etiquetas: quality.manage crea, edita, envía y revisa; quality.view lee.
- Plan analítico: como los prerrequisitos (quality.manage gestiona; el responsable de un punto registra sus
  resultados y lo ve en **Lo mío** › «Mis muestras»; quality.view lee).
- Los invitados no entran (403).

### Pantallas

- **Productos** (`/calidad/productos`): la lista con familia, alérgenos, vida útil y estado del etiquetado;
  **Nuevo producto**. La ficha de cada producto (`/calidad/productos/:id`): datos, alérgenos, nutricional,
  estudios de vida útil y etiquetas con su revisión.
- **Plan analítico** (`/calidad/plan-analitico`): por tipo, cada punto con su parámetro, criterio, último
  resultado, estado (Al día, Por vencer, Vencido) y **Repetido**; **Nuevo punto**, **Registrar resultado** e
  historial.
- **Panel**: muestras vencidas, resultados no conformes de los últimos 30 días, etiquetas desactualizadas o
  en revisión y productos listos para consumo sin estudio.

### API (fase 6b)

- `GET/POST /quality/products`, `GET/PATCH /quality/products/:id`, `POST /quality/products/:id/archive`
  `{ archived }`, `POST /quality/products/:id/folder`, `GET /quality/products/:id/files`.
- `POST /quality/products/:id/studies`, `POST /quality/studies/:id/result` `{ result, resultOn, conclusion?,
  reportNodeId?, openNc, severity? }`.
- `POST /quality/products/:id/labels` `{ nodeId?, note? }`, `POST /quality/labels/:id/review` `{ decision
  (APPROVE | REJECT), checks, reviewNote? }`.
- `GET/POST /quality/sampling`, `PATCH /quality/sampling/:id`, `POST /quality/sampling/:id/archive`,
  `POST /quality/sampling/:id/restore`, `GET/POST /quality/sampling/:id/results`.


### Hecho (fase 6b)

Hecha el 07/11/2026. Migración `quality_products_sampling` (`QualityProduct`, `QualityShelfLifeStudy`,
`QualityLabel`, `QualitySamplingPoint`, `QualityLabResult` y el origen `LAB`). Backend en
`products.service.ts`, `sampling.service.ts`, `products.schemas.ts` y `quality-folders.ts` (la carpeta de un
proveedor usa ahora el mismo ayudante); vencimiento `quality.sampling`; aviso `quality_label`. Pantallas
**Productos**, la ficha de cada producto y **Plan analítico**; el panel suma sus cifras. Demo
(`demoProducts`), capturas `calidad-productos`, `calidad-producto` y `calidad-plan-analitico`, guías
**Productos y etiquetas** y **Plan analítico** (es y en) y tests de seguridad.

Simplificaciones y añadidos:

- Una etiqueta aprobada queda contra la versión de la ficha **al aprobarla** (no al enviarla): es la que ve
  quien revisa.
- El documento de la ficha (`specNodeId`) se elige entre los archivos y páginas de la carpeta del producto,
  al editar la ficha.
- Enviar una etiqueta avisa a quien gestiona calidad; aprobarla o rechazarla avisa a quien la envió.
- La lista de productos pagina en el servidor; la de puntos, como la de prerrequisitos, trae hasta 500.
- Los invitados no entran a productos ni al plan analítico (403) ni pueden ser responsables de un punto.

## Fase 6c: cultura de seguridad alimentaria y gestión de cambios

Bloques 12 y 13. Se hace después de la 6b.

### Cultura de seguridad alimentaria

IFS 8 (1.2) y BRCGS 9 (1.1.2) piden un plan con actividades, su seguimiento y medir la cultura.

- **Plan anual**: `QualityCulturePlan` `{ workspaceId, year, objectives (hasta 4000) }` (único por año) y
  `QualityCultureActivity` `{ id, workspaceId, year, title (1 a 160), kind (TRAINING | COMMUNICATION |
  SURVEY | MEETING | OTHER), plannedOn (DATE), doneOn?, responsibleId?, note? (hasta 1000), archivedAt? }`.
  Vencimiento `quality.culture` al responsable hasta que se marca hecha.
- **Encuestas anónimas**: `QualityCultureSurvey` `{ id, workspaceId, title, questions (String[], 1 a 20, cada
  una hasta 200; por defecto diez afirmaciones sobre compromiso de la dirección, comunicación, formación,
  responsabilidad y comunicar problemas sin miedo), opensOn, closesOn, closedAt?, createdById }`.
  - Cada persona activa (no invitada) responde una vez mientras está abierta, del 1 (nada de acuerdo) al 5
    (muy de acuerdo), con un comentario opcional. Le aparece en **Mis pendientes**.
  - **Anonimato**: `QualityCultureAnswer` `{ id, workspaceId, surveyId, scores (Int[]), comment? }` no guarda
    quién ni cuándo (sin `createdAt`); quién ya respondió va en otra tabla, `QualityCultureVoter`
    `{ surveyId, membershipId }`, sin enlace con la respuesta. Ni el log de auditoría ni los avisos dicen
    qué respondió nadie.
  - **Resultados** (quality.view): participación, media y reparto por pregunta y los comentarios en orden
    aleatorio; solo con 5 respuestas o más (el mínimo en `packages/limits`).
- Panel: actividades vencidas y la participación y media de la última encuesta.

### Gestión de cambios

Una receta, un producto, una línea, un equipo, un proveedor o un proceso nuevos pasan por la revisión del
APPCC antes de aprobarse (IFS 4.2.1.3 y 2.3.1, BRCGS 1.1.11 y 2.3).

- `QualityChange` `{ id, workspaceId, year, number (código **CAM-AAAA-NNNN**), title (1 a 160), kind (RECIPE |
  PRODUCT | LINE | EQUIPMENT | SUPPLIER | PROCESS | OTHER), description (hasta 4000), productId?, plannedOn?,
  status (PROPOSED | APPROVED | REJECTED | IMPLEMENTED | CANCELLED), review (Json: haccp, allergens, label,
  training, validation, cada uno `pending | not_applicable | done` con su nota), impact? (NONE | LOW | HIGH),
  ownerId?, proposedById, decidedById?, decidedAt?, decisionNote?, implementedOn?, createdAt, updatedAt }`.
- Cualquier persona (no invitada) **propone** un cambio. quality.manage lo **revisa**: completa la revisión
  (peligros y PCC del APPCC, alérgenos, etiqueta y ficha, formación, validación) y lo **aprueba** (con la
  revisión del APPCC respondida) o lo **rechaza** con motivo. Aprobado, su responsable lo marca
  **implantado** cuando ningún punto queda pendiente.
- Vencimiento `quality.change` al responsable con `plannedOn` mientras está aprobado.
- Pantalla **Cambios** (`/calidad/cambios`): lista y ficha de cada cambio. Quien lo propuso lo ve, sin
  cambiarlo.


### Hecho (fase 6c)

Hecha el 08/11/2026. Migración `quality_culture_changes` (`QualityCulturePlan`, `QualityCultureActivity`,
`QualityCultureSurvey`, `QualityCultureAnswer`, `QualityCultureVoter`, `QualityChange` y
`QualityChangeCounter`). Backend en `culture.service.ts`, `changes.service.ts` y `culture.schemas.ts`;
vencimientos `quality.culture` y `quality.change`; aviso `quality_change`; el mínimo de respuestas y los
largos en `packages/limits` (`qualityLimits.survey*`, `objectivesMax`). Pantallas **Cultura**, responder una
encuesta (`/calidad/encuestas/:id`, desde **Mis pendientes**), **Cambios** y la ficha de cada cambio; el panel
suma sus cifras. Demo (`demoCulture`), capturas `calidad-cultura`, `calidad-encuesta`,
`calidad-encuesta-resultados`, `calidad-cambios` y `calidad-cambio`, guías **Cultura de seguridad
alimentaria** y **Gestión de cambios** (es y en) y tests de seguridad.

Simplificaciones y añadidos:

- La respuesta lleva un id aleatorio (`uuid`), no uno ordenado por tiempo, para que el id no diga cuándo se
  respondió. Responder no se anota en el registro de auditoría.
- Una encuesta se puede cambiar hasta la primera respuesta; después solo se cierra. Cierra sola al pasar su
  fecha de cierre.
- La participación es sobre las personas activas (no invitadas) de hoy, no las de la fecha de apertura.
- Quien no ve calidad ve en **Cultura** solo las actividades a su cargo, sin objetivos ni encuestas.
- Proponer un cambio avisa a quien gestiona calidad; asignarle responsable, aprobarlo o rechazarlo avisa a
  quien lo propuso y al responsable. Sin responsable, el vencimiento va a quien lo aprobó.
- El código de un cambio es **CAM-AAAA-NNNN** en los dos idiomas, como el de las no conformidades.

## Fases

1. **No conformidades y CAPA** (arriba): activación, permisos, NC con su ciclo, causa raíz, acciones,
   verificación de eficacia, evidencias, apertura desde un registro (manual y automática), avisos, listas y
   guías es/en.
2. **APPCC y registros de PCC** (bloques 1 y 2, detalle arriba): plan APPCC como documento controlado,
   cuadro de PCC enlazado con sus formularios, plantilla cárnica y producto retenido con su decisión
   firmada.
3. **Auditorías** (bloque 11, detalle arriba): programa anual con su cobertura por capítulo, externas con
   su sala de auditoría, hallazgos por cláusula que abren su NC.
4. **Proveedores** (bloque 8, detalle arriba): registro con riesgo y fraude, documentos con vencimiento,
   evaluación anual y sus NC.
5. **Reclamaciones y retirada** (bloques 6 y 7, detalle arriba): reclamaciones con plazo, respuesta y NC;
   indicador por millón de unidades; equipo y contactos de crisis y pruebas de retirada.
6. **Panel de indicadores** (bloque 14) y el resto, en tres partes: 6a panel y prerrequisitos (bloque 3);
   6b productos, etiquetado y plan analítico (9 y 10); 6c cultura de seguridad alimentaria y gestión de
   cambios (12 y 13).
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
7. Fase 6b: origen de NC nuevo **Analítica** (`LAB`) para resultados de laboratorio y estudios de vida útil
   no superados. Una etiqueta la puede aprobar quien la envió (queda registrado).
8. Fase 6c: encuestas de cultura anónimas por diseño (respuesta sin persona ni fecha, quién respondió en otra
   tabla) y resultados solo desde 5 respuestas.
