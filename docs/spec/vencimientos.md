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
- Si el responsable (persona) no puede ver el elemento, la app lo avisa al guardarlo.
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
- **Insignias**: «Vence el …» en ámbar (por vencer) y «Venció» en rojo, en el explorador y en la pantalla
  del elemento; vigente y lejos, sin insignia.
- **Vencimientos** (`/app/:slug/vencimientos`): lista con filtros en la URL y vista de calendario por mes;
  exportar a CSV. Ítem del menú lateral con el contador de lo propio.
- **Inicio**: tarjeta con los propios por vencer y vencidos.

## Fases

1. **Datos, API y avisos**: tipo `node`, responsable departamento y nota en el motor, rutas, pausa en la
   papelera, avisos a las 8:00 (campana y email). Hecha; los tests de permisos, aislamiento y avisos van
   al cierre del módulo (CLAUDE.md, «Pruebas»).
2. **Pantallas**: diálogo, insignias, pantalla con lista, calendario y CSV, Inicio, contador, propuesta al
   subir una versión nueva, guías es/en y capturas. Hecha.
