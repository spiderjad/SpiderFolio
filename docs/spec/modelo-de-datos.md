5. Conceptos del dominio
Concepto	Qué es
Workspace	Una empresa cliente. Todo dato pertenece a uno
Miembro	Usuario dentro de un workspace, con un rol y uno o más departamentos
Rol	Conjunto de capacidades administrativas (qué puede gestionar)
Departamento	Área de la empresa (Calidad, Producción, RR. HH.). Se usa para dar acceso a contenido
Espacio	Gran contenedor de contenido, normalmente uno por área o tema
Carpeta	Dentro de un espacio, anidable, contiene carpetas, archivos y páginas
Archivo	Documento subido (PDF, Word, Excel, imagen) con versiones
Página	Documento nativo tipo Notion, editado en el editor por bloques
Documento controlado	Página o archivo con código, flujo de aprobación y versión vigente

Rol y departamento son ejes distintos: el rol define qué puede administrar la persona; el departamento, qué contenido ve. No mezclarlos.

6. Modelo de datos (Prisma)

Toda tabla con datos de un cliente tiene workspaceId y se consulta solo con el cliente con tenant (7.3). Agregar relaciones @relation con onDelete: Cascade desde Workspace. Las claves foráneas entre tablas con tenant son compuestas (ej. Membership(roleId, workspaceId) → Role(id, workspaceId), con @@unique([id, workspaceId]) en la tabla referenciada): la base impide apuntar a otro workspace. Esas FK usan ON DELETE NO ACTION (no RESTRICT), que se verifica al final de la sentencia: purgar un workspace en cascada no depende del orden de los triggers y borrar un rol en uso sigue fallando. Ninguna FK usa SET NULL ni SET DEFAULT (sería un UPDATE, que el trigger de AuditLog rechaza; el borrado de cuentas y workspaces tiene tests). AuditLog.actorId no es FK: borrar una cuenta conserva la auditoría con un id seudónimo. El schema real vive en backend/prisma/schema.prisma; acá se resume. AuditLog tiene un trigger que rechaza UPDATE. Los límites de cada empresa viven en Workspace.limits (docs/spec/limites.md); la licencia de plugins en WorkspaceLicense y sus ajustes en PluginSetting (docs/spec/plugins.md).

prisma
enum SystemRole  { OWNER ADMIN MEMBER GUEST }
enum AccessLevel { MANAGE EDIT COMMENT VIEW }
enum DocStatus   { DRAFT IN_REVIEW APPROVED PUBLISHED OBSOLETE }
enum NodeType    { FOLDER FILE PAGE }
enum MemberStatus { ACTIVE SUSPENDED }
enum SeatType    { FULL READER }
enum SubStatus   { TRIALING ACTIVE PAST_DUE READ_ONLY SUSPENDED PENDING_DELETION }

model User {
  id              String    @id @default(cuid())
  email           String?   @unique           // null en usuarios de PIN (7.6)
  emailVerifiedAt DateTime?
  passwordHash    String?                     // null en usuarios de PIN
  kind            UserKind  @default(STANDARD) // STANDARD | PIN; un CHECK liga el tipo con email y passwordHash
  name            String
  avatarKey       String?
  locale          String    @default("es")
  failedLogins    Int       @default(0)
  lockedUntil     DateTime?
  totpSecretEnc   String?                     // 2FA (fase posterior), cifrado
  isStaff         Boolean   @default(false)   // backoffice interno (12A.3)
  createdAt       DateTime  @default(now())
}

model Workspace {
  id             String    @id @default(cuid())
  name           String
  slug           String    @unique
  logoKey        String?
  accentColor    String?                      // #rrggbb en minúsculas; null = color de la marca (10.2)
  allowedDomains String[]                     // ej. ["empresa.com"] para invitaciones
  storageUsedBytes BigInt  @default(0)        // ver docs/spec/limites.md
  settings       Json      @default("{}")     // políticas de seguridad (ver 10.9)
  createdAt      DateTime  @default(now())
  deletedAt      DateTime?
}

model Role {                                  // roles personalizados por workspace
  id          String     @id @default(cuid())
  workspaceId String
  name        String
  description String?
  base        SystemRole                       // nivel base que extiende
  capabilities String[]                        // ver 9.2
  isSystem    Boolean    @default(false)       // los 4 de sistema no se borran
  @@unique([workspaceId, name])
}

model Membership {
  id          String       @id @default(cuid())
  userId      String
  workspaceId String
  roleId      String
  status      MemberStatus @default(ACTIVE)
  seatType    SeatType     @default(FULL)      // ver docs/spec/limites.md
  jobTitle    String?
  createdAt   DateTime     @default(now())
  lastSeenAt  DateTime?
  @@unique([userId, workspaceId])
}

model Department {
  id          String   @id @default(cuid())
  workspaceId String
  name        String
  description String?
  color       String?
  parentId    String?                          // subdepartamentos opcionales
  managerId   String?                          // membershipId del responsable
  createdAt   DateTime @default(now())
  @@unique([workspaceId, name])
}

model DepartmentMember {
  departmentId String
  membershipId String
  @@id([departmentId, membershipId])
}

model Session {                               // una fila por refresh token (7.1)
  id              String    @id @default(cuid())
  userId          String
  familyId        String
  familyCreatedAt DateTime                     // login que originó la familia: base del tope absoluto
  tokenHash       String    @unique
  userAgent       String?
  ip              String?
  idleSeconds     Int?                         // sesiones de PIN (tablets): vence tras este lapso sin uso, tope absoluto de 8 h
  expiresAt       DateTime                     // mín(último uso + REFRESH_TTL_DAYS, familyCreatedAt + tope)
  revokedAt       DateTime?
  replacedAt      DateTime?                    // revocada por rotación (no por logout): margen de 5 s y reuso
  createdAt       DateTime  @default(now())
  lastUsedAt      DateTime  @default(now())
}

model AuthToken {
  id        String    @id @default(cuid())
  userId    String
  type      String                             // VERIFY_EMAIL | RESET_PASSWORD
  tokenHash String    @unique
  expiresAt DateTime
  usedAt    DateTime?
}

model Invitation {
  id            String    @id @default(cuid())
  workspaceId   String
  email         String
  roleId        String
  seatType      SeatType
  departmentIds String[]
  tokenHash     String    @unique
  invitedById   String
  expiresAt     DateTime
  acceptedAt    DateTime?
  revokedAt     DateTime?
}

model Space {
  id          String   @id @default(cuid())
  workspaceId String
  name        String
  icon        String?
  description String?
  isPrivate   Boolean  @default(false)         // privado: solo con permiso explícito
  isConfidential Boolean @default(false)       // confidencial (implica privado): los administradores no entran solos
  includeSubareas Boolean @default(false)      // espacio de departamento: los miembros de los subdepartamentos también entran
  createdAt   DateTime @default(now())
  archivedAt  DateTime?
}

// Árbol único: carpetas, archivos y páginas son nodos.
model Node {
  id            String     @id @default(cuid())
  workspaceId   String
  spaceId       String
  parentId      String?                        // debe ser FOLDER o PAGE
  type          NodeType
  name          String
  icon          String?
  position      String                         // índice fraccional
  inheritAccess Boolean    @default(true)
  // documento controlado (opcional para FILE y PAGE)
  isControlled  Boolean    @default(false)
  code          String?
  status        DocStatus?
  currentVersion Int       @default(0)
  reviewDueAt   DateTime?
  ownerDepartmentId String?
  createdById   String
  updatedById   String
  createdAt     DateTime   @default(now())
  updatedAt     DateTime   @updatedAt
  trashedAt     DateTime?                      // papelera (30 días)
  @@unique([workspaceId, code])
  @@index([workspaceId, spaceId, parentId])
}

model PageContent {
  nodeId      String   @id
  workspaceId String
  content     Json                             // documento Tiptap/ProseMirror
  updatedAt   DateTime @updatedAt
}

model FileVersion {                           // cada subida de un archivo
  id          String   @id @default(cuid())
  workspaceId String
  nodeId      String
  version     Int
  storageKey  String   @unique                 // aleatorio, nunca el nombre original
  fileName    String
  mimeType    String
  sizeBytes   Int
  checksum    String                           // SHA-256
  uploadedById String
  createdAt   DateTime @default(now())
  @@unique([nodeId, version])
}

model PageVersion {                           // instantánea inmutable al publicar
  id          String    @id @default(cuid())
  workspaceId String
  nodeId      String
  version     Int
  title       String
  content     Json
  changeNote  String?
  createdById String
  createdAt   DateTime  @default(now())
  @@unique([nodeId, version])
}

model Permission {                            // sobre un espacio O un nodo
  id           String      @id @default(cuid())
  workspaceId  String
  spaceId      String?
  nodeId       String?
  membershipId String?                         // sujeto: persona…
  departmentId String?                         // …o departamento
  level        AccessLevel
  grantedById  String
  expiresAt    DateTime?                       // accesos temporales
  createdAt    DateTime    @default(now())
}

model Approval {
  id          String    @id @default(cuid())
  workspaceId String
  nodeId      String
  version     Int
  approverId  String
  decision    String?                          // APPROVED | REJECTED
  comment     String?
  decidedAt   DateTime?
}

model ReadRequirement {                       // quién debe leer una versión
  id           String   @id @default(cuid())
  workspaceId  String
  nodeId       String
  version      Int
  departmentId String?
  membershipId String?
  dueAt        DateTime?
}

model ReadAcknowledgment {
  id          String   @id @default(cuid())
  workspaceId String
  nodeId      String
  version     Int
  userId      String
  readAt      DateTime @default(now())
  @@unique([nodeId, version, userId])
}

model RateLimitBucket {                        // rate limit compartido (12). Tabla UNLOGGED
  key     String   @id                         // SHA-256 de la clave: sin IPs ni emails
  hits    Int
  resetAt DateTime
  @@index([resetAt])
}

model UsageCounter {
  workspaceId String
  periodStart DateTime
  aiQueries   Int      @default(0)
  @@id([workspaceId, periodStart])
}

model UploadReservation {
  id          String   @id @default(cuid())
  workspaceId String
  bytes       BigInt
  expiresAt   DateTime
}

model Notification {
  id          String    @id @default(cuid())
  workspaceId String
  userId      String
  type        String
  title       String
  body        String?
  link        String?
  readAt      DateTime?
  createdAt   DateTime  @default(now())
  @@index([userId, workspaceId, readAt])
}

model NotificationPreference {
  userId      String
  workspaceId String
  type        String
  email       Boolean @default(true)
  inApp       Boolean @default(true)
  digest      Boolean @default(false)
  @@id([userId, workspaceId, type])
}

model Favorite {
  userId String
  nodeId String
  @@id([userId, nodeId])
}

model AuditLog {                              // append-only
  id          String   @id @default(cuid())
  workspaceId String?
  actorId     String?
  action      String                           // "auth.login", "node.move", "permission.grant"…
  entityType  String?
  entityId    String?
  ip          String?
  userAgent   String?
  metadata    Json?                            // nunca contenido ni secretos
  createdAt   DateTime @default(now())
  @@index([workspaceId, createdAt])
  @@index([workspaceId, entityType, entityId])
}

// Ingreso con usuario + PIN de lectores de planta sin email (7.6). Una fila por membresía.
model PinLogin {
  id             String    @id @default(cuid())
  workspaceId    String
  membershipId   String    @unique
  loginName      String                        // minúsculas, 3 a 32 de [a-z0-9._-]; único por workspace
  pinHash        String                        // argon2id del PIN de 6 dígitos
  failedAttempts Int       @default(0)         // al llegar a 5 se bloquea
  lockCount      Int       @default(0)         // bloqueos consecutivos: 15, 30 y 60 min (tope)
  lockedUntil    DateTime?
  pinChangedAt   DateTime  @default(now())
  pinChangedById String?                       // quién creó o reseteó el PIN
  createdAt      DateTime  @default(now())

  @@unique([workspaceId, loginName])
}
