// Colas de pg-boss y sus payloads (CLAUDE.md, sección 12A.2). Los payloads nunca llevan
// secretos ni datos personales: para un email va el userId, y el worker busca el resto.
import { z } from "zod";

const UserId = z.string().min(1);

export const EmailJobSchema = z.discriminatedUnion("kind", [
  // Con token: el worker lo crea al enviar (nunca viaja en la cola).
  z.strictObject({ kind: z.literal("verify-email"), userId: UserId }),
  z.strictObject({ kind: z.literal("reset-password"), userId: UserId }),
  // Invitación a un workspace: el worker crea el token al enviar y guarda su hash en la
  // invitación; en la cola solo viaja el id (nunca el token ni el email).
  z.strictObject({ kind: z.literal("invitation"), invitationId: z.string().min(1) }),
  // Avisos de seguridad.
  z.strictObject({ kind: z.literal("password-changed"), userId: UserId }),
  z.strictObject({ kind: z.literal("mfa-enabled"), userId: UserId }),
  z.strictObject({ kind: z.literal("mfa-disabled"), userId: UserId }),
  // Un administrador reinició la 2FA de la persona: el worker busca el nombre del workspace.
  z.strictObject({
    kind: z.literal("mfa-reset"),
    userId: UserId,
    workspaceId: z.string().min(1),
  }),
  z.strictObject({ kind: z.literal("new-login"), userId: UserId, sessionId: z.string().min(1) }),
  // ZIP grande en segundo plano: el worker crea el enlace al enviar (nunca viaja en la cola).
  // Cambio de email pedido por la propia persona: el worker crea el enlace y escribe al nuevo.
  z.strictObject({ kind: z.literal("email-change"), userId: UserId }),
  // Te mencionaron en una página o un comentario.
  z.strictObject({ kind: z.literal("mention"), mentionId: z.string().min(1) }),
  // Te dieron acceso directo a un espacio o a un elemento.
  z.strictObject({
    kind: z.literal("shared"),
    permissionId: z.string().min(1),
  }),
  // Aviso de un documento controlado (aprobación pendiente, aprobado o rechazado, lectura…): el worker
  // lee la Notification y arma el texto; en la cola solo viaja el id.
  z.strictObject({ kind: z.literal("document-notice"), notificationId: z.string().min(1) }),
  z.strictObject({ kind: z.literal("export-ready"), exportId: z.string().min(1) }),
  z.strictObject({ kind: z.literal("export-failed"), exportId: z.string().min(1) }),
]);
export type EmailJob = z.infer<typeof EmailJobSchema>;

/** PDF controlado de una versión publicada: lo genera el worker con Gotenberg. */
export const ControlledPdfJobSchema = z.strictObject({
  workspaceId: z.string().min(1),
  nodeId: z.string().min(1),
  version: z.number().int().min(1),
});

/** Texto de un PDF o DOCX subido (búsqueda): una tarea por versión del archivo. */
export const TextExtractJobSchema = z.strictObject({
  workspaceId: z.string().min(1),
  nodeId: z.string().min(1),
  version: z.number().int().min(1),
});

/** Reindexado de la búsqueda; `full` rehace el índice de todo, no solo lo pendiente. */
export const SearchReindexJobSchema = z.strictObject({ full: z.boolean().optional() });

export const MaintenanceJobSchema = z.strictObject({});

/** Claves de objetos (workspaceId/nodeId/versión-aleatorio): sin nombres de archivo ni datos. */
export const ObjectsDeleteJobSchema = z.strictObject({
  keys: z.array(z.string().min(1).max(300)).min(1).max(500),
});

/** Importación de un ZIP: solo el id; el worker lee el resto de ImportJob. */
export const ZipImportJobSchema = z.strictObject({ importId: z.string().min(1) });

/** ZIP grande en segundo plano: solo el id; el worker lee el resto de ZipExport. */
export const ZipExportJobSchema = z.strictObject({ exportId: z.string().min(1) });

export const queues = {
  "email-send": {
    schema: EmailJobSchema,
    options: {
      retryLimit: 5,
      retryDelay: 30,
      retryBackoff: true,
      expireInSeconds: 120,
      deleteAfterSeconds: 24 * 3600,
      deadLetter: "email-failed",
      // LISTEN/NOTIFY: el worker despierta apenas se encola (el email de verificación llega ya).
      notify: true,
    },
  },
  // Emails que agotaron los reintentos: se registran y se avisan a Sentry.
  "email-failed": {
    schema: EmailJobSchema,
    options: { retryLimit: 0, deleteAfterSeconds: 14 * 24 * 3600 },
  },
  "maintenance-cleanup": {
    schema: MaintenanceJobSchema,
    options: { retryLimit: 2, expireInSeconds: 300, deleteAfterSeconds: 7 * 24 * 3600 },
  },
  // Subidas que quedaron a medias: aborta lo subido y libera la cuota reservada (9A.4).
  "uploads-cleanup": {
    schema: MaintenanceJobSchema,
    options: { retryLimit: 2, expireInSeconds: 600, deleteAfterSeconds: 3 * 24 * 3600 },
  },
  // Objetos de S3 de lo que se eliminó para siempre (las filas ya se borraron): con reintentos,
  // borrar un objeto que no existe no es un error.
  "objects-delete": {
    schema: ObjectsDeleteJobSchema,
    options: {
      retryLimit: 8,
      retryDelay: 60,
      retryBackoff: true,
      expireInSeconds: 600,
      deleteAfterSeconds: 7 * 24 * 3600,
    },
  },
  // Descomprime un ZIP importado. Sin reintentos automáticos: un reintento a medias duplicaría
  // trabajo; el estado final queda en ImportJob.
  "zip-import": {
    schema: ZipImportJobSchema,
    options: {
      retryLimit: 0,
      expireInSeconds: 3600,
      deleteAfterSeconds: 7 * 24 * 3600,
      notify: true,
    },
  },
  // Arma un ZIP grande y lo guarda en el bucket de sistema. Sin reintentos automáticos (un
  // reintento a medias repetiría un trabajo pesado); el estado final queda en ZipExport.
  "zip-export": {
    schema: ZipExportJobSchema,
    options: {
      retryLimit: 0,
      expireInSeconds: 3 * 3600,
      deleteAfterSeconds: 7 * 24 * 3600,
      notify: true,
    },
  },
  // Avisa los accesos compartidos que vencen en 2 días (campana), a quien los recibió y a quien los dio.
  "access-expiry-notices": {
    schema: MaintenanceJobSchema,
    options: { retryLimit: 2, expireInSeconds: 600, deleteAfterSeconds: 7 * 24 * 3600 },
  },
  // PDF controlado al publicar una página (Gotenberg). Con reintentos: el contenedor puede tardar.
  "controlled-pdf": {
    schema: ControlledPdfJobSchema,
    options: {
      retryLimit: 4,
      retryDelay: 20,
      retryBackoff: true,
      expireInSeconds: 300,
      deleteAfterSeconds: 7 * 24 * 3600,
    },
  },
  // Texto de los PDF y DOCX subidos, para la búsqueda de texto completo.
  "text-extract": {
    schema: TextExtractJobSchema,
    options: {
      retryLimit: 2,
      retryDelay: 30,
      retryBackoff: true,
      expireInSeconds: 600,
      deleteAfterSeconds: 3 * 24 * 3600,
    },
  },
  // Reindexado de la búsqueda: lo pendiente cada noche, o todo cuando se pide.
  "search-reindex": {
    schema: SearchReindexJobSchema,
    options: { retryLimit: 1, expireInSeconds: 3600, deleteAfterSeconds: 7 * 24 * 3600 },
  },
  // Bian: reindexa los nodos que cambiaron (los marcan triggers de la base). Cada minuto, solo si Bian
  // está habilitado.
  "bian-index": {
    schema: MaintenanceJobSchema,
    options: { retryLimit: 1, expireInSeconds: 600, deleteAfterSeconds: 24 * 3600 },
  },
  // Recordatorios de lectura: actúa solo en los workspaces donde son las 8:00 de su zona horaria.
  "reading-reminders": {
    schema: MaintenanceJobSchema,
    options: { retryLimit: 2, expireInSeconds: 900, deleteAfterSeconds: 7 * 24 * 3600 },
  },
  // Semanal: recorta el registro de auditoría según la retención que fija cada workspace (si fija una).
  "audit-retention": {
    schema: MaintenanceJobSchema,
    options: { retryLimit: 2, expireInSeconds: 3600, deleteAfterSeconds: 14 * 24 * 3600 },
  },
  // Papelera: elimina lo que lleva más de 30 días.
  "trash-expire": {
    schema: MaintenanceJobSchema,
    options: { retryLimit: 2, expireInSeconds: 1800, deleteAfterSeconds: 7 * 24 * 3600 },
  },
} as const;

export type QueueName = keyof typeof queues;
export type QueuePayload<Q extends QueueName> = z.infer<(typeof queues)[Q]["schema"]>;

/**
 * Tareas periódicas. Las limpiezas corren en UTC, una sola vez por tick en todo el clúster
 * (pg-boss garantiza un único job por horario aunque haya varios workers).
 *
 * Patrón para avisos por zona horaria (recordatorios y vencimientos "a las 8:00 locales",
 * módulos futuros): un único job horario en UTC que selecciona los workspaces donde en ese
 * momento son las 8:00 según settings.timezone. Nunca un cron por workspace.
 */
export const schedules = [
  { queue: "maintenance-cleanup", cron: "15 * * * *", tz: "UTC" },
  { queue: "uploads-cleanup", cron: "*/15 * * * *", tz: "UTC" },
  { queue: "trash-expire", cron: "30 3 * * *", tz: "UTC" },
  { queue: "audit-retention", cron: "20 4 * * 0", tz: "UTC" },
  { queue: "access-expiry-notices", cron: "10 * * * *", tz: "UTC" },
  { queue: "reading-reminders", cron: "5 * * * *", tz: "UTC" },
  { queue: "search-reindex", cron: "40 2 * * *", tz: "UTC" },
  { queue: "bian-index", cron: "* * * * *", tz: "UTC" },
] as const;
