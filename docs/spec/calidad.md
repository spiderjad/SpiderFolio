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

Estado: **spec en revisión**. No hay código todavía.

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

### Fuera de la fase 1

- Bloqueo del lote y decisión sobre el producto (reproceso, otro destino, SANDACH, liberación firmada): fase
  2, con los PCC.
- Bian, el conector MCP y la búsqueda general no ven las NC (sí sus archivos, como cualquier archivo).
- Sin plazos máximos de cierre por gravedad ni escalados automáticos.

## Fases

1. **No conformidades y CAPA** (arriba): activación, permisos, NC con su ciclo, causa raíz, acciones,
   verificación de eficacia, evidencias, apertura desde un registro (manual y automática), avisos, listas y
   guías es/en.
2. **APPCC y registros de PCC** (bloques 1 y 2): plan APPCC como documento controlado (tipo **APPCC**,
   revisión anual); plantilla cárnica de formularios de vigilancia (recepción, cámaras, secaderos, cocción,
   enfriamiento, detector de metales) con sus límites y apertura automática de NC; QR en cada PCC; producto
   no conforme con bloqueo y liberación firmada.
3. **Auditorías** (bloque 11): programa anual de internas por cláusula de la norma, externas, hallazgos que
   abren NC con su cláusula; el auditor externo ve sus evidencias en una sala de auditoría.
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
