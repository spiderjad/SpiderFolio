# Vencimientos

Núcleo (docs/spec/adopcion.md, 9C.7). Plan aprobado el 03/11/2026. Usa el motor de vencimientos genérico
(docs/spec/seguridad-salud.md, «Motor de vencimientos») con el tipo **`node`**: el elemento es un archivo o
una página (también un formulario). Es distinto de la fecha de revisión de los documentos controlados
(`reviewDueAt`), que no cambia: un documento controlado puede tener las dos.

## Qué guarda

- Un vencimiento por elemento (`Expiry` con `kind = "node"`, `subjectId` = el nodo): **fecha** (día de la
  empresa), **responsable** (una persona, `responsibleId`, o un departamento, `responsibleDepartmentId`),
  **días de aviso** (por defecto 30, 7 y el mismo día) y una **nota** (hasta 500).
- El motor suma `responsibleDepartmentId` y `note`, genéricos (también para la CAE). Un responsable
  departamento recibe los avisos en sus **jefes y subjefes**.
- Estado: `valid`, `due_soon` (dentro del mayor umbral) o `expired`.

## Permisos

- **Ver** un vencimiento: poder ver el elemento. Lista, calendario, CSV, tarjeta de Inicio, contador e
  insignias solo muestran lo que la persona ve.
- **Poner, cambiar o quitar**: poder **editar** el elemento, o tener **`expirations.manage`** y poder verlo.
- Los avisos solo van a quienes **pueden ver el elemento** (el aviso revela su nombre): la persona responsable,
  o los jefes y subjefes del departamento que lo ven. Si nadie de ellos puede, el aviso va a quien lo puso
  (`Expiry.setById`), si lo ve. La app lo avisa al guardar (`responsibleCantSee`).
- Auditoría: `node.expiry.set`, `node.expiry.remove`, `expiries.export`. Un elemento de otra empresa: 404.

## Ciclo de vida

- En la **papelera** el vencimiento espera (no avisa); al restaurar el elemento vuelve a avisar. Borrado
  para siempre, se resuelve.
- Al subir una **versión nueva** de un archivo con vencimiento, la app ofrece actualizarlo y propone **el
  mismo plazo de antes** (hoy + la distancia entre la fecha anterior y el día en que se puso).

## API

- `GET /nodes/:id/expiry` → `{ expiry | null, canEdit }`; `PUT /nodes/:id/expiry` `{ dueOn, responsible:
  { type: "person" | "department", id } | null, noticeDays?, note? }`; `DELETE /nodes/:id/expiry`.
- `GET /expiries` (cursor; `space`, `department` —el del responsable o el del espacio—, `responsible`,
  `status`, `from`, `to`), `GET /expiries/export` (CSV, hasta 10.000), `GET /expiries/space/:id` (los de
  un espacio, para las insignias del explorador), `GET /expiries/mine` (los propios por vencer o vencidos,
  para Inicio) y `GET /expiries/mine/count` (el contador del menú: solo lo propio, por vencer o vencido).
- `GET /expiries/filters`: espacios, departamentos y personas que aparecen en lo que la persona ve (las
  opciones de los filtros, sin exponer el directorio). `GET /nodes/:id/expiry/responsible-options?q=`:
  personas (con si pueden ver el elemento) y departamentos, solo para quien puede poner el vencimiento.
- «El mismo plazo» toma el día en que se puso del último `node.expiry.set` de la auditoría (`updatedAt`
  también cambia cuando sale un aviso).

## Pantallas

- Diálogo **Vencimiento** desde el menú «⋯» del elemento en el explorador y desde su pantalla (página,
  archivo y formulario).
- **Insignias**, siempre que hay vencimiento, con el tiempo que queda y el color del estado: verde «Vence en
  31 días», ámbar «Vence en 5 días», rojo «Venció hace 2 días» (la fecha, en el tooltip). En el explorador y
  en la pantalla del elemento.
- **Sin responsable elegido**, lo es quien lo pone (el diálogo lo dice): siempre alguien recibe el aviso. Los
  vencimientos anteriores a esa regla sin responsable los asignó una migración (`expiry_missing_responsible`) a
  quien los puso (según `node.expiry.set` en la auditoría, si sigue activo) o, si no, al propietario.
- **Sugerir con Bian** (`POST /nodes/:id/expiry/suggest`): lee el texto vigente de la página o el archivo y
  propone fecha, nota y responsable (este solo si el nombre coincide con exactamente una persona o un
  departamento). Nunca guarda: rellena el diálogo. Solo con Bian activo, para quien puede ponerlo, con la
  cuota de Bian (se devuelve si falla), el documento como dato y auditoría `ai.expiry_suggest` sin contenido.
- **Vencimientos** (`/app/:slug/vencimientos`): lista con filtros en la URL y vista de calendario por mes;
  exportar a CSV. Ítem del menú lateral con el contador de lo propio: rojo si hay alguno vencido, ámbar si
  solo hay por vencer (`/expiries/mine/count` → `{ count, expired }`); al pasar el puntero, el detalle
  («1 vencido · 2 por vencer»).
- **Inicio**: tarjeta con los propios por vencer y vencidos.

## Fases

1. **Datos, API y avisos**: tipo `node`, responsable departamento y nota en el motor, rutas, pausa en la
   papelera, avisos a las 8:00 (campana y email). Hecha; los tests de permisos, aislamiento y avisos van
   al cierre del módulo (CLAUDE.md, «Pruebas»).
2. **Pantallas**: diálogo, insignias, pantalla con lista, calendario y CSV, Inicio, contador, propuesta al
   subir una versión nueva, guías es/en y capturas. Hecha.
