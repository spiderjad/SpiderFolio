# Mantenimiento

Núcleo, abierto y gratis, **apagado por defecto** y activable por empresa, como Prevención, Calidad y
Medio ambiente. Spec aprobada por el mantenedor el 09/11/2026, con las siete propuestas de «Decisiones».

Pensado primero para una planta cárnica: muchas máquinas (picadoras, embutidoras, hornos, cámaras,
envasadoras, detectores de metales), poco tiempo para escribir y las manos ocupadas o con guantes. Por eso
el centro del módulo es **avisar y cerrar órdenes de trabajo hablando**: el operario o el técnico dicta un
audio desde el móvil y la IA lo convierte en la orden de trabajo (OT) o en su cierre.

Lo que resuelve: el registro de cada **equipo**, las **OT** correctivas y preventivas con su historial, el
**preventivo** que genera sus OT solo, una **sugerencia de resolución** con IA que tira del historial del
equipo y de sus manuales, los **indicadores** (MTBF, MTTR, preventivo frente a correctivo) y lo que piden
IFS Food 8 (4.16, mantenimiento; 4.17.4, liberación higiénica tras una intervención) y BRCGS 9 (4.7). Los
**repuestos y su stock vienen de otro sistema** (el ERP): el módulo deja preparada la API para leerlos y
para descontar lo que se usa.

## Activación y permisos

- En **Administración › Seguridad › General**, la tarjeta **Mantenimiento**. Solo el propietario. Crea el
  espacio del módulo («Mantenimiento») en su área, con una carpeta por equipo para manuales, esquemas y
  certificados. Apagarlo oculta el área y pausa los avisos; nunca borra datos.
- **`maintenance.manage`**: todo (equipos, planes preventivos, asignar, cerrar, ajustes). Por defecto,
  propietario y Administrador.
- **`maintenance.work`**: técnicos. Ven todas las OT, toman las suyas, registran trabajo, tiempos y
  repuestos y las dan por hechas.
- **`maintenance.view`**: ver todo sin cambiar nada (dirección, calidad).
- **Cualquier persona activa** (menos los invitados) puede **avisar de una avería** y ver las que avisó:
  también las plazas de lector y las cuentas de **usuario + PIN** de las tablets de planta (como llenar un
  registro, docs/spec/formularios.md). Cambiado el 10/11/2026: en planta hay gente sin PC.
- Área propia en la barra, **«Mantenimiento»**. Un recurso de otra empresa responde 404.

## 1. Equipos

- `MaintAsset` `{ id, code (único por empresa, p. ej. EMB-02), name, parentId? (línea › máquina ›
  componente), location, manufacturer?, model?, serial?, installedOn?, criticality (A | B | C), foodContact
  (boolean: zona de producto, decide la liberación higiénica), status (OPERATING | STOPPED | RETIRED),
  folderId? (sus documentos), notes }`.
- **QR por equipo** con la infraestructura de QR que ya existe: pegado en la máquina, abre «Avisar de una
  avería» con el equipo ya elegido, o su ficha si quien lo escanea es de mantenimiento.
- Ficha del equipo: datos, documentos (manuales), historial de OT, plan preventivo, indicadores y piezas
  habituales.
- Importación desde CSV para cargar el parque de equipos de una vez.

## 2. Órdenes de trabajo (OT)

- `MaintWorkOrder` `{ id, year, number (código **OT-AAAA-NNNN**), assetId?, kind (CORRECTIVE | PREVENTIVE |
  IMPROVEMENT | SAFETY | HYGIENE), priority (URGENT | HIGH | NORMAL | LOW), status, title, description,
  symptom?, reportedById, reportedAt, assignedToId?, dueOn?, startedAt?, doneAt?, closedAt?, downtimeMinutes?,
  cause?, solution?, verifiedById?, hygieneReleasedById?, hygieneReleasedAt?, planId? (si viene del
  preventivo), source (APP | AUDIO | QR | PREVENTIVE | API) }`.
- Estados: **Avisada** → **Planificada** (asignada y con fecha) → **En curso** → **En espera** (de repuesto o
  de parada de línea, con motivo) → **Hecha** (el técnico) → **Cerrada** (quien gestiona la verifica).
- Trabajo: `MaintLabor` `{ workOrderId, membershipId, startedAt, endedAt?, minutes }` (varios técnicos,
  varias tandas) y `MaintPartUse` `{ workOrderId, partCode, description, quantity, unit, source (STOCK |
  MANUAL), postedAt? }` (los repuestos usados; ver sección 6).
- Fotos y adjuntos en la carpeta del equipo (o de la OT si no tiene equipo), con las subidas de siempre.
- **Liberación higiénica** (IFS 4.17.4, BRCGS 4.7.4): una OT sobre un equipo con `foodContact` no se cierra
  hasta que alguien con `quality.manage` (o, sin Calidad activo, quien gestiona mantenimiento) confirma que
  la zona quedó limpia, sin restos de herramientas ni piezas. Queda quién y cuándo.
- **Seguridad**: una OT puede pedir **consignación (LOTO)** y permiso de trabajo; con Prevención activo
  enlaza a sus permisos de trabajo (CAE si lo hace una contrata).
- Avisos: al técnico asignado, al pasar una OT urgente, al vencer su fecha; por el motor de vencimientos.

## 3. Avisar y cerrar hablando (audio)

**Avisar de una avería** (móvil primero, también desde el QR del equipo):

1. Botón grande **«Grabar»**. La persona cuenta qué pasa («la embutidora dos pierde presión y hace un ruido
   en la bomba desde esta mañana»). Puede repetir o escribir en lugar de hablar.
2. El audio se **transcribe** (decisión 2) y la IA lo convierte en una propuesta de OT: título corto, equipo
   (el del QR, o el que nombra, buscado por código y nombre entre los equipos), síntoma, prioridad sugerida
   (con su motivo: «parada de línea», «zona de producto») y tipo.
3. La persona ve la propuesta, la corrige si hace falta y **confirma**. Nada se crea sin confirmar.

**Cerrar hablando**: el técnico, en la OT, dicta qué encontró y qué hizo («era el retén de la bomba,
cambiado por uno nuevo, media hora, probado con producto»). La IA propone **causa, solución, tiempo y
repuestos** (buscando los códigos entre los repuestos, sección 6) y el técnico confirma.

- El audio se guarda **30 días** junto a la OT (para revisar una transcripción dudosa) y después se borra;
  la transcripción queda. Ni el audio ni el texto salen de la instalación salvo hacia los servicios de IA
  configurados (decisión 2).
- Idioma: el de la persona (español o inglés; catalán si el motor lo soporta).
- Cada transcripción y cada propuesta cuentan en el consumo de IA de la empresa (los límites de Bian).
- Sin IA configurada (Bian apagado), avisar y cerrar se hace escribiendo: el módulo funciona igual.

## 4. Resolución con IA

En la OT, **«Sugerir resolución»**: la IA lee el síntoma y responde con **posibles causas y pasos a
seguir**, ordenados por probabilidad, **citando de dónde lo saca**:

- el **historial del equipo** (OT cerradas con síntomas parecidos: «OT-2026-0142: mismo ruido, era el retén
  de la bomba»), y de equipos del mismo modelo;
- los **manuales y procedimientos** del equipo, con la búsqueda de Bian (solo lo que la persona puede ver);
- los repuestos usados en esos casos.

Es siempre una **sugerencia**: el técnico decide. Se guarda en la OT qué se sugirió y si sirvió («útil / no
útil»), para mejorar. Fuera de esto, la IA nunca cambia el estado de una OT ni pide repuestos.

## 5. Preventivo

- `MaintPlan` `{ assetId, name, every (días, semanas o meses) | meterEvery (horas o ciclos de un contador),
  checklist (pasos), formId? (un formulario de SpiderFolio como hoja de registro), assignedToId?,
  estimatedMinutes, nextDueOn, active }`.
- Un trabajo diario del worker **genera las OT preventivas** cuando toca (unos días antes, configurable) y
  calcula la siguiente al cerrarla.
- **Lecturas de contador** del equipo (horas de funcionamiento, ciclos) a mano o por la API (sección 6),
  para los planes por uso.
- **Calibración**: los equipos de medida (termómetros, básculas, detectores de metales) llevan su plan de
  calibración con certificado y vencimiento; con Calidad activo, aparecen en su prerrequisito de
  calibración en lugar de duplicarse (decisión 5).

## 6. Repuestos y stock (API preparada)

El catálogo de repuestos y su stock son del **SGA** (sistema de gestión de almacén) de la empresa, o del
ERP. SpiderFolio no lleva un
almacén: **lee** el stock y **avisa** del consumo.

- **Punto de extensión para plugins** (pluginApi 5, `ctx.maintenanceStock`), como el conector de
  trazabilidad de Calidad: un plugin del ERP (SAP, Navision, A3, el que sea) implementa
  - `searchParts(query)`: buscar repuestos por código o descripción (para el desplegable y para la IA);
  - `getStock(codes)`: existencias y ubicación en el momento;
  - `postConsumption(workOrder, lines)`: dar la salida de almacén al cerrar la OT (o encolarla si el ERP no
    responde, con reintentos y estado visible en la OT).
- **API REST de integración** para los sistemas que prefieren empujar datos: con un **token de
  integración** por empresa (creado por el propietario, con permisos limitados a mantenimiento, revocable y
  auditado):
  - `PUT /api/v1/integrations/maintenance/parts` — alta o actualización masiva del catálogo y del stock
    (`code, description, unit, stock, location, minStock`);
  - `GET /api/v1/integrations/maintenance/consumption?since=…` — los consumos de las OT para que el ERP los
    descuente, con un cursor;
  - `POST /api/v1/integrations/maintenance/readings` — lecturas de contadores (horas, ciclos) desde el
    autómata o el MES;
  - `POST /api/v1/integrations/maintenance/work-orders` — una OT desde otro sistema (una alarma del
    SCADA), con `source = API`.
- Sin plugin ni integración: los repuestos se escriben a mano en la OT (código y descripción libres) y se
  exportan en CSV para pasarlos al ERP.
- `MaintPart` `{ code, description, unit, stock?, location?, minStock?, syncedAt? }` es una **copia de
  lectura** de lo que manda el ERP; nunca se edita en SpiderFolio.

## 7. Indicadores

Por equipo, línea y período: **MTBF** (tiempo medio entre averías), **MTTR** (tiempo medio de reparación),
**disponibilidad**, horas de parada, **% preventivo frente a correctivo**, OT abiertas, vencidas y en
espera de repuesto, cumplimiento del preventivo y los equipos con más averías. Panel del área (Resumen) y
exportación CSV.

## 8. Enlace con Calidad (cámaras, secaderos…)

Pedido por el mantenedor el 10/11/2026 y **hecho ese día** (sin probar por el mantenedor): migración
`maintenance_quality_link` (`MaintWorkOrder.ncId`, origen `QUALITY`), `maintenance/quality-link.ts`,
`workOrderForNc` y `workOrdersOfNc` en `work-orders.service.ts`, `askMaintenance` y
`POST /quality/ncs/:id/maintenance` en Calidad.

Cómo quedó: **el equipo lo nombra el propio registro**, sin configurar nada. Si una respuesta de opción o de
texto del registro es el código o el nombre de un equipo activo, o empieza por él antes de « · »
(«Cámara 1 · canales» nombra al equipo «Cámara 1»), y la NC se abre sola, se crea la **OT urgente** de ese
equipo (o se enlaza la que ya tiene abierta). Si el registro no nombra un equipo (o nombra dos), no se crea
nada y Calidad la pide a mano. Lo de los PCC apuntando a un equipo queda para más adelante, si hace falta.
Cuando la OT queda hecha, cerrada, cancelada o reabierta, la NC lo anota en su historial y avisa a su
responsable.

Lo que se propuso:

- **Equipo en el registro de Calidad**: los puntos de control (PCC) y los formularios de vigilancia
  (Temperatura de cámaras, Curva de secaderos, Cocción…) pueden apuntar a un **equipo** (la cámara 3, el
  secadero 2).
- **Lectura fuera de límite → OT**: cuando un registro sale fuera de rango en un equipo (la cámara a 9 °C,
  el secadero con la humedad fuera de curva), además de la no conformidad se crea (o se propone) una **OT
  correctiva urgente** en ese equipo, enlazada con la NC. Si ya hay una OT abierta del mismo equipo, se
  enlaza a esa en vez de duplicar.
- **Ida y vuelta**: la NC muestra su OT y su estado; al cerrar la OT, la NC lo ve («reparado el
  compresor, OT-2026-0012») y Calidad decide si la cierra o retiene producto.
- **Desde la NC**: un botón «Pedir a mantenimiento» crea la OT del equipo con el texto de la NC.
- La **liberación higiénica** (sección 2) ya la da Calidad; la **calibración** de sondas e instrumentos
  (decisión 5) aparece en su prerrequisito.

## 9. Gente de planta sin PC

Pedido por el mantenedor el 10/11/2026: en planta hay personas sin ordenador (y a veces sin email). Cómo
avisan, sin nada nuevo que instalar:

- **Tablet compartida en la línea o en el vestuario**, con el ingreso **usuario + PIN** (CLAUDE.md 7.6):
  la persona entra con su PIN, toca **«Avisar de una avería»** (o escanea el QR del equipo con la tablet),
  cuenta qué pasa y la sesión se cierra sola por inactividad. Las cuentas con PIN **pueden avisar** (no
  tenían plaza completa: cambiado en la fase 1).
- **Su móvil**, escaneando el **QR pegado en el equipo**: abre el aviso con el equipo ya elegido; si no
  tiene sesión, entra (con su cuenta o su usuario + PIN) y vuelve al aviso.
- **Hablando** (fase 2): botón grande «Grabar», sin escribir. Pensado para guantes, ruido y pantallas
  chicas: todo a 375 px, botones grandes, sin menús.
- **El técnico** tampoco tiene PC en la planta: «Mis órdenes» y la ficha de la OT (empezar, parar,
  repuestos, cerrar hablando) se usan desde el móvil.

Queda para decidir (no se hace sin tu visto bueno): un **aviso sin cuenta** desde el QR del equipo (sin
iniciar sesión, con nombre opcional, límite de envíos y un QR que se puede revocar), para quien no tiene ni
usuario + PIN.

## Pantallas

- **Avisar de una avería** (móvil, a 375 px, con el botón de grabar grande; también desde el QR).
- **Mis OT** (técnico): las asignadas y las urgentes, para el día.
- **Órdenes de trabajo**: lista con filtros (estado, prioridad, equipo, tipo, asignada), vista de tablero
  por estado opcional.
- **Ficha de la OT**: cronología, audio y transcripción, sugerencia de IA, trabajo, repuestos, cierre,
  liberación higiénica.
- **Equipos** (árbol línea › máquina › componente) y su ficha; **Preventivo** (calendario de lo que toca);
  **Resumen** con los indicadores.
- spider-ui (`v-*`), listas paginadas con cursor y filtros en la URL.

## Fases

1. **Equipos y OT a mano**: activación, permisos, equipos con QR y documentos, OT con su ciclo, trabajo,
   repuestos manuales, liberación higiénica, avisos. Avisar desde el QR escribiendo.
   **Hecha el 09/11/2026**, sin probar por el mantenedor. Quedan para más adelante: la importación de equipos
   desde CSV y las fotos propias de cada OT (por ahora, en la carpeta del equipo).
2. **Audio e IA para avisar y cerrar**: grabación, transcripción, propuesta de OT y de cierre.
   **Hecha el 10/11/2026**, sin probar por el mantenedor. Migración `maintenance_audio` (`MaintRecording`:
   la nota con su transcripción; el audio en el almacenamiento hasta 30 días). `WHISPER_URL` y el contenedor
   `whisper` (perfil `audio`, `onerahmet/openai-whisper-asr-webservice:v1.10.0`, modelo `small`); sin él,
   el dictado del navegador (solo Chrome, Edge y Safari). Backend en `voice.service.ts`
   (`/maintenance/voice`, `/maintenance/voice/report`, `/maintenance/work-orders/:id/voice`,
   `/maintenance/recordings/:id/audio`), con el modelo ligero de Bian y salida JSON con esquema fijo;
   cada transcripción y cada propuesta reservan una consulta de IA (se devuelve si falla). La limpieza de
   cada hora borra el audio de más de 30 días y las notas de aviso sin confirmar de más de 24 horas.
   Frontend: botón grande «Grabar» en Avisar (la IA rellena el formulario y la persona confirma),
   «Cerrar hablando» en la OT (tiempo, repuestos y «hecha» con las acciones de siempre) y las notas de voz
   en la ficha. El reconocimiento de repuestos por código queda para la fase 5 (catálogo del SGA).
3. **Preventivo**: planes, generación automática de OT, contadores, calibración.
   **Hecha el 10/11/2026**, sin probar por el mantenedor. Migración `maintenance_preventive` (`MaintPlan`,
   `MaintMeter`, `MaintMeterReading`; `MaintWorkOrder.planId` y `checklist`; tipo de OT `CALIBRATION`).
   `plans.service.ts`: planes por tiempo (días, semanas o meses) o por uso (cada N unidades de un contador),
   con tareas, técnico, minutos estimados, antelación y consignación. La cola `maintenance-plans` (cada hora)
   crea la OT del plan que toca, una a la vez; también al crear o editar el plan y al anotar una lectura.
   Hecha → la siguiente cuenta desde ese día (o desde la lectura); cancelada → se salta esa. Pantalla
   **Preventivo** (planes y contadores), tareas a marcar en la OT, y en Calidad › Prerrequisitos la tarjeta
   «Calibraciones de Mantenimiento» (solo lectura, decisión 5).
4. **Resolución con IA**: sugerencia con historial y manuales, valoración.
   **Hecha el 10/11/2026**, sin probar por el mantenedor. Migración `maintenance_suggestions`
   (`MaintSuggestion`). `suggest.service.ts`: el historial resuelto del equipo y de los del mismo modelo
   (hasta 30, con sus repuestos), los fragmentos de documentos que Bian encuentra para el equipo y el
   síntoma (solo lo que la persona puede ver) y el modelo de Bian con salida JSON fija; solo se guardan
   las fuentes que existen y que cita. Una consulta de IA. En la ficha de la OT, «Sugerir resolución» con
   las causas, sus pasos, sus fuentes enlazadas y «Útil / No útil».
5. **Repuestos y stock**: punto de extensión para plugins, API de integración con token, catálogo de solo
   lectura, consumo.
6. **Indicadores** y Resumen.
7. **Tests de seguridad** al cerrar el módulo (cuando el mantenedor lo pida): permisos de cada capacidad,
   quien avisa solo ve lo suyo, tokens de integración (alcance, revocación, empresa), audio y transcripción
   solo de quien puede ver la OT, aislamiento entre empresas.

Cada fase con su guía (es y en) y sus capturas.

## Decisiones (aprobadas el 09/11/2026: las siete propuestas; el stock vive en un SGA)

1. **Núcleo gratis**, como los demás módulos; el audio y la IA solo con Bian activo. Propuesta: sí.
2. **Transcripción del audio**, tres opciones:
   - (a) **Whisper autoalojado**: un contenedor más en la instalación (como Gotenberg), el audio no sale del
     servidor y no hay coste por uso; necesita algo de CPU (unos segundos por audio).
   - (b) Un **servicio de transcripción en la nube** con su clave de API: lo más preciso con ruido de
     planta, pero el audio sale del servidor y tiene coste por minuto.
   - (c) El **reconocimiento de voz del navegador**: gratis y sin servidor, pero la calidad depende del
     móvil y del navegador.
   Propuesta: (a), y (c) cuando la instalación no tenga el contenedor. Agregar el contenedor es una
   dependencia nueva: necesita tu visto bueno.
3. **Stock**: punto de extensión para plugins **y** API REST con token de integración (las dos, como arriba).
   Propuesta: las dos; primero la API REST (sirve para cualquier ERP sin plugin) y el punto de extensión
   cuando haya un conector concreto.
4. **Audio guardado 30 días** y después borrado (queda la transcripción). Propuesta: sí.
5. **Calibración**: llevarla en Mantenimiento y que Calidad la vea en su prerrequisito, sin duplicar.
   Propuesta: sí.
6. **Liberación higiénica obligatoria** para cerrar una OT en un equipo de zona de producto. Propuesta: sí.
7. **Orden de las fases**: la de arriba (sin la fase 1 no hay dónde colgar el audio). Propuesta: sí, y si
   quieres ver el audio antes, las fases 1 y 2 juntas.
