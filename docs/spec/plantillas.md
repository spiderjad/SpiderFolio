# Plantillas propias y por rubro (plugin `templates`)

Estado: **borrador para aprobar** (08/11/2026). Nada de código hasta que el mantenedor lo apruebe.

## Qué resuelve

Hoy el núcleo trae 5 plantillas fijas de página (en blanco, procedimiento, instrucción de trabajo, acta de
reunión y bienvenida; `packages/content`, `pageTemplates`). Una empresa no puede guardar las suyas ni
partir de un conjunto armado para su sector. El plugin agrega dos cosas:

1. **Plantillas propias**: «Guardar como plantilla» sobre una página o una carpeta, y después «Nuevo ›
   Desde una plantilla de la empresa» en cualquier carpeta.
2. **Paquetes por rubro**: conjuntos listos para instalar (carpetas, páginas modelo, tipos de documento y
   departamentos sugeridos), para que una pyme no empiece con la app vacía.

Precio orientativo: 290 € / 190 USD, pago único (docs/estado-proyecto.md del repo de plugins).

## Arquitectura: como el conector MCP

La lógica vive en el **núcleo**, apagada, y el plugin la enciende con su licencia (feature
`custom_templates`), igual que `mcp-connector` enciende `mcp_write`. Motivo: crear páginas y carpetas
tiene que pasar por los mismos servicios que la app (`forTenant`, `resolveAccess`, límites, auditoría,
nombres repetidos, posición), y el SDK de plugins no expone el contenido. Así no hay un segundo camino
para escribir contenido.

- Núcleo: modelo, servicio, rutas y pantallas, con `plugins.hasFeature(workspaceId, "custom_templates")`.
  Sin la feature: 404 en las rutas y nada en el menú.
- Plugin `templates`: declara `features: ["custom_templates"]`, la capacidad `templates:manage` y los
  **paquetes por rubro como datos** (JSON en el plugin; nuevo punto de extensión `templatePacks` del SDK,
  pluginApi 4). Los paquetes son lo que se vende, así que no van en el repo público.
- Se borra el esqueleto actual del plugin (pantalla «Próximamente» y la migración `plugin_templates`,
  que nunca se aplicó con datos).

## 1. Plantillas propias

**Guardar como plantilla** (menú «⋯» de una página o carpeta; requiere `templates:manage` y poder ver el
origen):
- Página: guarda su contenido actual (borrador si lo tiene, si no la versión vigente), nombre, ícono y
  portada.
- Carpeta: guarda el árbol de carpetas y páginas que la persona **puede ver**, hasta los límites de la
  empresa (`templateNodesMax`, `templateDepthMax`, en `packages/limits`). **Los archivos no se copian**
  (decisión propuesta: ocupan cuota y suelen ser documentos firmados); la carpeta queda y la plantilla avisa
  «N archivos no se incluyen».
- Documento controlado: se guarda el tipo (PRC, INS…) y el departamento responsable, nunca el código, las
  versiones, las aprobaciones ni las lecturas.
- Se copia una foto (`snapshot`): si el original cambia o se borra, la plantilla sigue igual. Imágenes
  incrustadas: se copian al guardar (cuentan para la cuota de la empresa); menciones e hilos de comentarios,
  no.
- Datos: nombre, descripción, categoría libre y quién la creó.

**Usar una plantilla** (botón Nuevo del explorador, `folderActions`; cualquiera que pueda crear en esa
carpeta):
- Diálogo con buscador, categorías y vista previa del árbol.
- Crea todo en una transacción con los servicios del núcleo; nombres repetidos se resuelven como al pegar
  («Procedimiento (2)»). Los documentos controlados nacen en **borrador**, con su código asignado al crearlos
  como siempre.
- Las páginas nuevas heredan los permisos de la carpeta donde se crean (nunca los del original).

**Administración › Plantillas** (`templates:manage`): lista paginada con cursor (nombre, categoría,
páginas, carpetas, quién y cuándo), renombrar, cambiar descripción y categoría, borrar. Todo queda en la
auditoría (`template.created`, `template.used`, `template.deleted`).

Modelo (núcleo):
```prisma
model Template {
  id          String   @id @default(cuid())
  workspaceId String
  name        String
  nameKey     String
  description String   @default("")
  category    String?
  kind        TemplateKind // PAGE | FOLDER
  snapshot    Json         // árbol validado con Zod (versión del formato incluida)
  nodeCount   Int
  createdById String
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  @@unique([workspaceId, nameKey])
}
```
El `snapshot` se valida al leerlo con el mismo esquema que el contenido de las páginas
(`packages/content`): una plantilla corrupta da error, nunca contenido sin validar.

## 2. Paquetes por rubro

**Administración › Plantillas › Paquetes**: tarjetas por rubro con lo que trae cada uno; «Instalar» abre
una vista previa y pide el espacio de destino (uno existente o uno nuevo).

Qué puede traer un paquete:
- Árbol de carpetas y páginas modelo con la nota «Modelo orientativo: adáptalo a tu empresa».
- Tipos de documento (PRC, INS, FOR, POL, MAN) si la empresa no los tiene ya (no pisa los suyos).
- Departamentos sugeridos: se ofrecen con casillas, nunca se crean sin elegirlos.
- Al instalar, sus plantillas quedan también como plantillas propias de la empresa, para reutilizarlas.

Instalar dos veces no duplica: se avisa y se instala en otra carpeta o se cancela.

Paquetes de la primera versión (propuesta, en español; inglés después):
- **Alimentación / cárnicas**: manual de calidad, control de documentos, compras y proveedores,
  APPCC (complementa al módulo Calidad, no lo reemplaza), limpieza y desinfección, plan de emergencia,
  acogida.
- **Industria**: procedimientos de producción, mantenimiento, compras, PRL básica, acogida.
- **Servicios y oficinas**: acogida, política de seguridad de la información, registro de actividades de
  tratamiento (RGPD), teletrabajo.

## Seguridad (tests al cerrar el módulo)

- Plantillas de otra empresa: 404 (listar, usar, borrar, vista previa).
- Guardar una carpeta solo incluye lo que la persona puede ver; una página privada o confidencial que no ve
  no entra en la plantilla.
- Usar exige poder crear en la carpeta destino; invitados no pueden guardar ni usar.
- Sin la feature `custom_templates` (licencia vencida o plugin quitado): 404 y las plantillas guardadas
  quedan intactas (vuelven con la licencia).
- Límites de tamaño y profundidad respetados; contenido del `snapshot` validado.

## Preguntas para el mantenedor

1. ¿Los archivos de una carpeta se dejan fuera (propuesta) o se copian ocupando cuota?
2. ¿Quién guarda plantillas: solo con `templates:manage` (propuesta) o cualquiera que edite la página?
3. ¿Los paquetes por rubro de la primera versión son esos tres, o otro orden (por ejemplo, solo cárnicas
   primero, por el piloto)?
4. ¿Las plantillas fijas del núcleo (las 5 actuales) siguen siempre visibles junto a las de la empresa?
   (propuesta: sí).
