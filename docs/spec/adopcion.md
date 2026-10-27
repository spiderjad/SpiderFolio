9C. Funciones de adopción y diferenciales (entran en el lanzamiento)

Objetivo: que una pyme vea su problema resuelto en los primeros 10 minutos y que el producto se entienda al verlo en una fábrica u oficina.

9C.1 Plantillas por rubro y puesta en marcha
packages/templates: paquetes en español por sector (Industria, Alimentación, Logística, Salud y laboratorios, Servicios y oficinas). Cada paquete define departamentos sugeridos, espacios, árbol de carpetas, páginas modelo y numeración de documentos controlados (PRC, INS, FOR, POL, MAN).
Páginas modelo mínimas: manual de calidad, procedimiento de control de documentos, procedimiento de compras y evaluación de proveedores, plan de emergencia, acogida de nuevos empleados, política de seguridad de la información, registro de actividades de tratamiento (RGPD). Cada una lleva la nota visible "Modelo orientativo: adáptalo a tu empresa".
Asistente de puesta en marcha tras el registro (se puede saltar y retomar): 1) sector, 2) departamentos (precargados y editables), 3) paquetes de plantillas, 4) importar una carpeta, 5) invitar al equipo.
Checklist "Puesta en marcha" en el inicio con barra de progreso (crear departamentos, subir documentos, publicar el primer documento controlado, invitar a 3 personas, pedir la primera lectura) hasta completarla o descartarla.
Datos de ejemplo: opción "Probar con datos de ejemplo" que crea una empresa ficticia marcada como ejemplo y se elimina con un clic.
Plantillas propias (Profesional y Empresa): "Guardar como plantilla" sobre cualquier página o carpeta.
9C.2 Importación de carpetas
Arrastrar y soltar una carpeta completa (o elegirla con webkitdirectory) conserva la estructura: el frontend recorre el árbol, llama a POST /nodes/import-plan con la estructura y tamaños, el backend valida cuota, tipos y nombres, crea las carpetas en una transacción y devuelve los destinos de subida; los archivos entran a la cola de subidas existente (reanudable, con progreso global y por archivo).
Importar ZIP: se sube el ZIP y el worker lo descomprime en el destino. Protección contra bombas ZIP: límite de archivos (5.000), de tamaño descomprimido (según cuota) y de profundidad; rutas con .. rechazadas.
Resumen final: importados, omitidos (con motivo) y duplicados detectados por checksum.
9C.3 Comentarios y menciones
Comentarios generales en páginas y archivos, y comentarios anclados a un fragmento del texto en páginas (marca Tiptap con threadId).
Hilos con respuestas, editar y borrar los propios, resolver y reabrir.
Menciones con @ a personas del workspace; si la persona no tiene acceso al documento, se avisa y se ofrece compartir (nunca se concede acceso automáticamente).
Requiere nivel COMMENT. Los lectores pueden comentar.
Panel lateral "Comentarios" con filtros (abiertos, resueltos, míos).
9C.4 Comparar versiones
Páginas: comparación visual entre dos versiones cualesquiera (por defecto, borrador contra vigente) con agregados en verde suave y quitados en rojo tachado, por bloque y por palabra. Se compara el Markdown generado con packages/content usando diff (jsdiff).
Archivos PDF, DOCX y XLSX: comparación del texto extraído, con aviso de que el formato no se compara.
La pantalla de aprobación muestra la comparación por defecto.
9C.5 PDF controlado
Al publicar un documento controlado, el worker genera su PDF con Gotenberg (contenedor HTML → PDF): cabecera con logo, código, título, versión, fecha de entrada en vigor, elaborado/revisado/aprobado por, y pie con paginación "Página X de Y".
En cada descarga se estampa con pdf-lib la marca de agua "Copia no controlada · descargada por [nombre] el [fecha]". La versión vigente siempre es la de la app.
Documentos obsoletos: marca "OBSOLETO" diagonal.
Para archivos subidos (PDF) como documento controlado: se agrega una hoja de control al principio y la misma marca en las descargas.
9C.6 Códigos QR en el puesto de trabajo
Desde cualquier documento: "Generar QR". URL corta app.tudominio.com/q/:token que siempre abre la versión vigente.
Por defecto exige iniciar sesión. Opción "QR público" (Profesional y Empresa, capacidad content.public_qr) solo con nivel de lectura y solo para ese documento, pensada para instrucciones de seguridad para contratistas; revocable en cualquier momento.
Hoja de etiquetas imprimible (PDF A4) con QR, código, título y nombre del área, en tamaños pequeño, mediano y grande.
Contador de escaneos (sin datos personales en los QR públicos).
Librería qrcode.
9C.7 Vencimientos
Cualquier archivo o página puede tener fecha de vencimiento, días de aviso (por defecto 30, 7 y el mismo día) y un responsable: seguros, certificados de proveedores, habilitaciones, revisiones de equipos, contratos.
Pantalla Vencimientos (/app/:slug/vencimientos): lista y vista de calendario, filtros por espacio, departamento, responsable y estado (vigente, por vencer, vencido), exportable a CSV.
Insignias en el árbol y en el explorador; tarjeta en el inicio.
Subir una versión nueva ofrece actualizar la fecha.
Distinto de la fecha de revisión de los documentos controlados, que se mantiene como está.
9C.8 "Mis documentos" (vista del operario)
Ruta /app/:slug/mis-documentos, pensada primero para el celular: lecturas pendientes con botón grande "Leí y comprendo", novedades de mis departamentos esta semana, favoritos y documentos recientes.
Es la página de inicio por defecto para usuarios con plaza READER.
PWA instalable (manifest e íconos) para tenerla como app en el celular.
9C.9 Sala de auditoría (Profesional y Empresa)
El responsable arma una sala con documentos, carpetas e informes (cumplimiento de lecturas, historial de aprobaciones, registro de auditoría filtrado) y la comparte con un auditor externo por email.
El auditor recibe un enlace y un código de un solo uso por email; entra a una vista de solo lectura con marca de agua, sin ver nada más del workspace.
Vencimiento obligatorio (máximo 30 días), descarga opcional, revocable, y cada acceso queda registrado (fecha, IP, qué vio).
Capacidad audit.share. No ocupa plaza de lector.
9C.10 Web pública
Página Seguridad (/seguridad): dónde se alojan los datos (UE), cifrado en tránsito y en reposo, copias de seguridad, aislamiento entre empresas, permisos, RGPD, lista de subencargados y contacto para seguridad.
Página Plantillas (/plantillas) mostrando los paquetes por sector.
En el inicio, bloques destacados para QR, vencimientos y sala de auditoría.
9C.11 Modelo de datos adicional
prisma
model Comment {
  id          String    @id @default(cuid())
  workspaceId String
  nodeId      String
  threadId    String                         // primer comentario del hilo = su propio id
  parentId    String?
  anchored    Boolean   @default(false)      // anclado a un fragmento de texto
  authorId    String
  body        String                         // texto plano con menciones @[userId]
  resolvedAt  DateTime?
  resolvedById String?
  editedAt    DateTime?
  deletedAt   DateTime?
  createdAt   DateTime  @default(now())
  @@index([workspaceId, nodeId, threadId])
}

model Mention {
  commentId String
  userId    String
  @@id([commentId, userId])
}

model Expiration {
  nodeId      String   @id
  workspaceId String
  expiresAt   DateTime
  noticeDays  Int[]    @default([30, 7, 0])
  ownerId     String                         // membershipId responsable
  note        String?
  @@index([workspaceId, expiresAt])
}

model QrCode {
  id          String    @id @default(cuid())
  workspaceId String
  nodeId      String
  token       String    @unique               // corto y aleatorio
  label       String?
  isPublic    Boolean   @default(false)
  scans       Int       @default(0)
  createdById String
  createdAt   DateTime  @default(now())
  revokedAt   DateTime?
}

model AuditRoom {
  id            String    @id @default(cuid())
  workspaceId   String
  name          String
  auditorEmail  String
  nodeIds       String[]
  reports       String[]                     // tipos de informe incluidos
  allowDownload Boolean   @default(false)
  tokenHash     String    @unique
  expiresAt     DateTime
  createdById   String
  createdAt     DateTime  @default(now())
  revokedAt     DateTime?
}

model AuditRoomAccess {
  id        String   @id @default(cuid())
  roomId    String
  ip        String?
  userAgent String?
  action    String                           // login | view | download
  nodeId    String?
  createdAt DateTime @default(now())
}

model ControlledPdf {
  nodeId      String
  version     Int
  workspaceId String
  storageKey  String   @unique
  createdAt   DateTime @default(now())
  @@id([nodeId, version])
}

model Template {                             // plantillas propias del workspace
  id          String   @id @default(cuid())
  workspaceId String
  name        String
  sourceNodeId String
  snapshot    Json
  createdById String
  createdAt   DateTime @default(now())
}

model OnboardingState {
  workspaceId String   @id
  sector      String?
  steps       Json     @default("{}")        // paso → completado
  dismissedAt DateTime?
  hasSampleData Boolean @default(false)
}
9C.12 Planes
	Inicial	Profesional	Empresa
Plantillas por rubro, importación de carpetas y ZIP	Sí	Sí	Sí
Comentarios, menciones, comparar versiones	Sí	Sí	Sí
PDF controlado con marca de agua	Sí	Sí	Sí
QR (con inicio de sesión) · QR públicos	Sí · —	Sí · Sí	Sí · Sí
Vencimientos con avisos	Sí	Sí	Sí
"Mis documentos" y app instalable	Sí	Sí	Sí
Plantillas propias	—	Sí	Sí
Sala de auditoría	—	Sí	Sí

Se agregan public_qr, custom_templates y audit_rooms a Feature en packages/plans.
