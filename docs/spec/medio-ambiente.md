# Medio ambiente

Núcleo, abierto y gratis, **apagado por defecto** y activable por empresa, como Seguridad y salud, Calidad y
el canal de denuncias. Spec aprobada por el mantenedor el 09/11/2026, con las siete propuestas de «Decisiones».

Pensado primero para una **industria cárnica en España**, donde lo ambiental pesa mucho: residuos y
subproductos animales (SANDACH), vertidos con mucha carga orgánica, consumo de agua y energía, y equipos
de frío con gases fluorados. Sirve de base para la **ISO 14001** si la piden los clientes. Términos `latam`:
la obligación equivalente de cada país, con los textos generales.

Lo que resuelve: tener **en un sitio** las autorizaciones ambientales y sus vencimientos, el **archivo
cronológico de residuos** que pide la ley, las **analíticas de vertido** contra sus límites, los
**consumos** con sus indicadores por tonelada producida y los **equipos con gases fluorados** con sus
revisiones de fugas, y llegar a una inspección o una auditoría con todo a mano.

## Marco legal (España)

| Tema | Norma | Qué pide |
|---|---|---|
| Residuos | Ley 7/2022 de residuos y suelos contaminados | Archivo cronológico (art. 64): cantidad, naturaleza, origen, destino, frecuencia de recogida, medio de transporte y tratamiento; conservarlo 5 años. Tiempo máximo de almacenamiento: 6 meses los peligrosos, 2 años los no peligrosos para valorización y 1 año para eliminación (art. 18) |
| Traslados | Real Decreto 553/2020 | Documento de identificación (DI) de cada traslado, contrato de tratamiento con el gestor y notificación previa en los casos que la piden |
| SANDACH | Reglamento (CE) 1069/2009 y (UE) 142/2011 | Categoría 1, 2 o 3; documento comercial de cada expedición y registro de las expediciones, que se conserva 2 años |
| Vertidos | Autorización de vertido (al colector municipal o a cauce) | Límites por parámetro y analíticas con la frecuencia de la autorización |
| Gases fluorados | Reglamento (UE) 2024/573 y Real Decreto 115/2017 | Registro de cada equipo; control de fugas por empresa habilitada según las toneladas de CO₂ equivalente; registro de recargas y recuperaciones |
| Frío industrial | Real Decreto 552/2019 | Inspecciones periódicas de las instalaciones frigoríficas (también de amoniaco) |
| Emisiones | Real Decreto 1042/2017 | Controles periódicos de los focos (calderas) según su grupo |
| Autorización | Ley 16/2002 (AAI, mataderos y transformación por encima de los umbrales) o la licencia ambiental autonómica | Las condiciones de la autorización y su revisión |

## Activación

- En **Administración › Seguridad › General**, la tarjeta **Medio ambiente**, como Calidad. Solo el
  propietario. Se guarda en `Workspace.settings.environment` = `{ enabled, spaceId? }`.
- La primera activación crea el **espacio del módulo** («Medio ambiente»), listado en su área, para los
  documentos (autorizaciones, contratos de tratamiento, DI, informes de laboratorio, certificados).
- Desactivar oculta el área y pausa los avisos. **Nunca borra datos.**
- Auditoría general: `environment.enable`, `environment.disable` y cada alta, cambio y baja del módulo.

## Permisos

- **`environment.manage`**: todo lo del módulo. Por defecto, propietario y Administrador.
- **`environment.view`**: ver todo, sin cambiar nada (dirección, auditores internos).
- **`environment.record`**: registrar retiradas de residuos, lecturas de consumo y analíticas, sin tocar
  el catálogo, las autorizaciones ni los equipos (el encargado de mantenimiento o de expediciones). Ve lo
  que registra y el catálogo.
- Los documentos son archivos del espacio del módulo y siguen sus permisos. Un recurso de otra empresa
  responde 404.

## 1. Autorizaciones y obligaciones periódicas

El registro de lo que la empresa **tiene** (autorizaciones, inscripciones, licencias) y de lo que tiene que
**hacer cada cierto tiempo**.

- `EnvPermit` `{ id, kind (AAI | ENVIRONMENTAL_LICENSE | DISCHARGE | WASTE_PRODUCER | SANDACH_REGISTRY |
  EMISSIONS | OTHER), name, authority, reference (número de expediente o inscripción), issuedOn?,
  expiresOn?, reviewOn?, conditions (texto), ownerId?, archivedAt? }`, con sus documentos en una carpeta
  del espacio.
- `EnvObligation` `{ id, name, permitId?, every (meses), lastDoneOn?, nextDueOn, ownerId?, notes }`: por
  ejemplo «Control de emisiones de la caldera» cada 36 meses, «Declaración anual de envases», «Analítica
  de vertido» cada 3 meses. Marcar como hecha pide la fecha y, si se quiere, el documento, y calcula la
  siguiente.
- Vencimientos y avisos por el motor de vencimientos (`environment.permit`, `environment.obligation`),
  al responsable o a quien tiene `environment.manage`.

## 2. Residuos y SANDACH

### Catálogo de residuos

- `EnvWaste` `{ id, name, ler (código LER de 6 cifras; con «*» si es peligroso), hazardous (calculado del
  LER), sandach (null | CAT1 | CAT2 | CAT3), operation (código R o D: R3, R13, D5…), managerId (gestor),
  carrierId? (transportista), contractRef?, maxStorageMonths (por defecto, según la ley: 6, 24 o 12),
  storageSince?, archivedAt? }`.
- Ejemplos de la plantilla cárnica (se cargan si se quiere, como el APPCC): subproductos de categoría 3
  (recortes, huesos), categoría 2 (estiércol del corral, contenido digestivo), categoría 1 (MER, si
  aplica), lodos de la depuradora, aceites usados, envases contaminados, plásticos y cartón, fluorescentes.

### Gestores y transportistas

- `EnvContractor` `{ id, name, nif?, nima?, authorizations (texto: números y tipos), roles (MANAGER |
  CARRIER), authorizationExpiresOn?, contact?, archivedAt? }`, con sus documentos (autorización, contrato
  de tratamiento). Aviso de vencimiento de la autorización.

### Retiradas (el archivo cronológico)

- `EnvWasteMovement` `{ id, wasteId, date, quantity, unit (kg | t | L | m3 | units), managerId,
  carrierId?, documentRef (número del DI o del documento comercial SANDACH), vehicle?, notes, fileNodeId?,
  recordedById, createdAt }`. Al registrar una retirada, el residuo vuelve a contar su almacenamiento desde
  ese día (`storageSince`).
- **Archivo cronológico** exportable en CSV y PDF por período, con los campos del art. 64; el **registro
  de expediciones SANDACH** por categoría. Se conservan al menos 5 años (no se borran desde la app; en
  `packages/limits`).
- **Resumen anual** por código LER y gestor (toneladas), para las declaraciones y la memoria.
- Aviso cuando un residuo se acerca a su **tiempo máximo de almacenamiento** sin retirada.

## 3. Vertidos

- La autorización de vertido es un `EnvPermit` de tipo `DISCHARGE` con sus **límites** por parámetro:
  `EnvDischargeLimit` `{ permitId, parameter (DQO, DBO5, sólidos en suspensión, aceites y grasas, pH,
  conductividad, nitrógeno, fósforo, temperatura u otro), unit, min?, max }`.
- `EnvDischargeSample` `{ id, permitId, takenOn, point, laboratory?, values ({ parameter, value }[]),
  fileNodeId?, recordedById }`: cada valor se compara con su límite; fuera de límite se marca en rojo y
  se avisa a quien tiene `environment.manage`.
- La frecuencia de las analíticas es una obligación periódica (sección 1).
- Gráfico por parámetro con su límite, para ver la tendencia.

## 4. Consumos e indicadores

- `EnvMeter` `{ id, name, kind (WATER_NETWORK | WATER_WELL | ELECTRICITY | NATURAL_GAS | DIESEL | LPG |
  OTHER), unit (m3 | kWh | L | kg), archivedAt? }`.
- `EnvReading` `{ meterId, month (AAAA-MM), value, recordedById }`: una lectura por contador y mes (el
  consumo del mes, no la lectura acumulada; o la acumulada y se calcula, decisión abajo).
- `EnvProduction` `{ month, tonnes }`: la producción del mes, para los **indicadores por tonelada**
  (m³ de agua por tonelada, kWh por tonelada). Más adelante, del ERP por el mismo conector de la
  trazabilidad (fase 7b de Calidad).
- Panel del área: consumo y ratio por mes, comparado con el mismo mes del año anterior, y los **objetivos**
  del año (`EnvTarget` `{ year, indicator, target }`).
- Emisiones de CO₂ equivalente de la energía con factores por defecto editables (alcance 1 y 2), solo
  informativo.

## 5. Gases fluorados y equipos de frío

- `EnvCoolingUnit` `{ id, name, location, refrigerant (R-404A, R-449A, R-134a, R-744, R-717…), chargeKg,
  gwp (del refrigerante, tabla en el código con los valores del reglamento; editable para «otro»),
  leakDetection (boolean), installerId? (empresa habilitada), installedOn?, archivedAt? }`.
- **Toneladas de CO₂ equivalente** = carga × PCA / 1000, calculadas. **Periodicidad del control de fugas**
  calculada: de 5 a 50 t, cada 12 meses; de 50 a 500, cada 6; desde 500, cada 3; con sistema de detección
  de fugas, el doble de tiempo. El amoniaco (R-717) y el CO₂ (R-744) no son gases fluorados: sus equipos
  llevan las inspecciones del Real Decreto 552/2019 como obligación periódica.
- `EnvCoolingEvent` `{ unitId, date, kind (LEAK_CHECK | RECHARGE | RECOVERY | REPAIR | INSPECTION),
  kgAdded?, kgRecovered?, leakFound?, company?, certificateRef?, fileNodeId? }`: el registro de cada
  equipo, exportable.
- Aviso del próximo control de fugas por el motor de vencimientos (`environment.leak_check`).
- Aviso informativo si el refrigerante tiene restricciones de uso o de mantenimiento (por ejemplo, R-404A
  en equipos grandes).

## 6. Aspectos ambientales (ISO 14001, opcional)

- `EnvAspect` `{ id, activity, aspect, impact, condition (NORMAL | ABNORMAL | EMERGENCY), frequency (1-3),
  severity (1-3), control (texto), significant (calculado: frecuencia × severidad ≥ umbral en
  `packages/limits`) }`. Los significativos se listan en el panel y piden un objetivo o un control.

## Pantallas

- Área **«Medio ambiente»** en la barra (con el módulo activo y `environment.*`): Resumen (vencimientos
  próximos, residuos que se acercan al tiempo máximo, última analítica fuera de límite, consumos del mes),
  Autorizaciones, Residuos (catálogo, retiradas, gestores), Vertidos, Consumos, Equipos de frío y, si se
  usa, Aspectos.
- Con spider-ui (`v-*`), listas paginadas con cursor y filtros en la URL, como el resto.
- Fuera de Bian y del conector MCP en la primera versión.

## Fases

1. **Activación, autorizaciones y obligaciones periódicas** con sus vencimientos (hecha el 09/11/2026, sin
   probar por el mantenedor).
2. **Residuos y SANDACH**: catálogo (con la plantilla cárnica), gestores y transportistas, retiradas,
   archivo cronológico y registro SANDACH exportables, resumen anual, aviso de almacenamiento (hecha el
   09/11/2026, sin probar por el mantenedor). Las retiradas no llevan adjunto propio: el DI o el documento
   comercial se guarda por su número y, si se quiere, en la carpeta del gestor. El Resumen del área llega con
   la fase 4 (consumos).
3. **Vertidos**: límites, analíticas, fuera de límite y gráfico (hecha el 09/11/2026, sin probar por el
   mantenedor; con «Abrir no conformidad» si Calidad está activa).
4. **Consumos e indicadores**: contadores, lecturas, producción, ratios, objetivos y panel (hecha el
   09/11/2026, sin probar por el mantenedor; el CO₂ de la energía queda para más adelante).
5. **Gases fluorados y equipos de frío** (hecha el 09/11/2026, sin probar por el mantenedor; PCA de
   referencia del IPCC AR4, editable en cada equipo).
6. **Aspectos ambientales** (si se pide).
7. **Tests de seguridad** al cerrar el módulo (cuando el mantenedor lo pida): permisos de cada capacidad,
   `environment.record` sin tocar el catálogo, aislamiento entre empresas, exportaciones.

Cada fase con su guía (es y en) y sus capturas.

## Decisiones (aprobadas el 09/11/2026: las siete propuestas)

1. **Núcleo gratis**, como Prevención y Calidad. Propuesta: sí.
2. **Área propia en la barra** («Medio ambiente»), no dentro de Calidad. Propuesta: sí.
3. **Gestores y transportistas**: registro propio (con NIMA y autorización), no los proveedores de Calidad
   ni las contratas de la CAE. Propuesta: registro propio; si además entran a planta, se dan de alta en la
   CAE como cualquier contrata.
4. **Analítica fuera de límite**: ¿abre una no conformidad de Calidad (si el módulo está activo) o solo
   avisa? Propuesta: solo aviso en la fase 3, y un botón «Abrir no conformidad» si Calidad está activa.
5. **Lecturas de consumo**: el consumo del mes o la lectura del contador (y se calcula la diferencia).
   Propuesta: la lectura del contador, que es lo que se apunta en planta, y la app calcula el consumo.
6. **Documento de identificación electrónico (eSIR)**: solo guardar su número y el PDF, sin conectarse
   al sistema del Ministerio. Propuesta: sí, de momento.
7. **Orden de las fases**: Propuesta: la de arriba (autorizaciones y residuos primero, porque son lo que
   más se inspecciona).
