# Formularios y registros

Núcleo, abierto y gratis. Base para calidad, mantenimiento y, después, la PRL (entrega de EPIs, formación…
serán plantillas de este mismo motor).

## Qué es

- Un **formulario** es un nodo del árbol (`NodeType.FORM`) dentro de un espacio o una carpeta, como una
  página: hereda accesos, papelera, mover y búsqueda.
- Su **plantilla** es una lista de campos guardada en **versiones** (`FormVersion`). Guardar una plantilla
  cambiada agrega la versión siguiente (`Node.currentVersion`). Las versiones nunca se editan ni se
  borran; cada registro queda ligado a la versión con que se llenó.
- Un **registro** es un formulario llenado: quién, cuándo (zona de la empresa), desde dónde (app o QR),
  respuestas, fotos y firma. Es inmutable; solo se puede **anular** con motivo (queda marcado, nunca se
  borra).

## Campos

Comunes: `id` (lo genera la app y se conserva entre versiones), `label`, `help` opcional, `required`.

| Tipo | Ajustes | No conforme |
| --- | --- | --- |
| `text` | `multiline` | — |
| `number` | `unit`, `min`, `max` | fuera de `[min, max]` |
| `yesno` | `nonConforming: "yes" \| "no" \| null` | esa respuesta |
| `choice` | `options` (2 a 50), `nonConforming` (ids) | una opción marcada |
| `date` | — | — |
| `checklist` | `items` (1 a 50) | un ítem sin marcar |
| `photo` | `max` (1 a 10) | — |
| `signature` | — | — |

Hasta 100 campos. El servidor valida todo (`modules/forms/forms.schemas.ts`): ids únicos, rango no
invertido, opciones no conformes que existan. La firma es simple (trazo, nombre y hora), no firma
electrónica avanzada.

## Permisos (decididos con el mantenedor)

- **Crear** un formulario: EDIT donde se crea. **Cambiar la plantilla**: EDIT sobre el formulario.
- **Ver** la plantilla y **llenarlo**: alcanza VIEW, incluidas las plazas de lector y las cuentas con PIN
  (llenar un registro no es editar documentación).
- **Ver registros**: quien llena ve los suyos; ven todos quien puede editar el formulario y su
  responsable.
- **Anular** un registro: quien gestiona el formulario (MANAGE), con motivo obligatorio. Queda marcado
  con quién, cuándo y por qué.
- Un formulario de otra empresa responde 404; auditoría de crear, versión nueva, registro (sin las
  respuestas), anular y exportar.

## Fases

1. **Modelo, editor de plantillas y versiones** (hecha): `POST /spaces/:id/forms`, `GET /forms/:id`,
   `PUT /forms/:id/template` (`baseVersion`: otra versión más nueva es conflicto; los mismos campos no
   agregan versión), `GET /forms/:id/versions`, `GET /forms/:id/versions/:version`. Pantalla
   `/app/:slug/files/:spaceId/form/:formId`; «Nuevo › Formulario» en el explorador.
2. **Llenado desde el celular, fotos y firma; registros inmutables** (hecha). Fotos y firma se suben antes
   de enviar (`POST /forms/:id/files` → URL prefirmada → `…/confirm`, que mira los bytes reales; reducen
   cuota) y se atan al registro al enviarlo (`POST /forms/:id/records` con `version` y `answers`); las que
   no llegan a un registro se borran al día (`form-file-sweep.ts`). El servidor revisa cada respuesta con
   la versión llenada (`modules/forms/answers.ts`) y calcula lo no conforme. `GET /forms/:id/records`
   (cursor; los propios, o todos con EDIT), `GET /forms/:id/records/:recordId` y la URL corta de cada
   adjunto. Pantallas `…/form/:formId/fill` (celular) y `…/form/:formId/r/:recordId`.
3. No conformidades (aviso al responsable, que se elige en la plantilla: persona o departamento; por
   defecto el jefe del departamento del espacio) y formularios periódicos (diario, semanal, mensual;
   asignados a personas o departamentos; pendientes y vencidos avisados a las 8:00 de la empresa).
4. Lista de registros con filtros (fechas en días de la empresa, persona, versión, solo no conformes),
   anular, CSV y PDF.
5. QR del formulario (abre el llenado), guías es/en, capturas y versión.

Fuera de la primera versión: lógica condicional, cálculos, uso sin conexión y galería de plantillas.
