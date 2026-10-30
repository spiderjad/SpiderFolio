// Entorno validado al arrancar (CLAUDE.md, sección 4). Si falta algo o JWT_ACCESS_SECRET es
// corto, el proceso no inicia. Los mensajes nombran la variable, nunca su valor.
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { s3EnvSchema } from "../lib/s3.ts";

// Las carpetas relativas (PLUGINS_DIR, PLUGIN_INSTALL_DIR) cuentan desde la raíz del repo, igual que en
// frontend/plugins.vite.ts, sea cual sea la carpeta desde la que arranca el proceso.
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

// Un valor vacío o solo con espacios (ej. `VARIABLE=   ` en el .env) cuenta como no definido.
const emptyToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;
const optionalString = z.preprocess(emptyToUndefined, z.string().min(1).optional());

/** "15m", "900s", "1h" → segundos. */
const durationSeconds = z
  .string()
  .regex(/^\d+[smh]$/, "Formato: número seguido de s, m o h")
  .transform((value) => {
    const amount = Number(value.slice(0, -1));
    const unit = value.at(-1);
    return amount * (unit === "h" ? 3600 : unit === "m" ? 60 : 1);
  });

export const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]),
    PORT: z.coerce.number().int().min(1).max(65535),
    APP_URL: z.url(),
    WEB_URL: z.url(),
    JWT_ACCESS_SECRET: z.string().min(64, "Mínimo 64 caracteres"),
    JWT_ACCESS_TTL: durationSeconds,
    REFRESH_TTL_DAYS: z.coerce.number().int().min(1).max(365),
    DATABASE_URL: z.url(),
    SMTP_HOST: z.string().min(1),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535),
    SMTP_USER: optionalString,
    SMTP_PASS: optionalString,
    MAIL_FROM: z.string().min(3),
    /** Dónde van los archivos: S3 (R2, MinIO…) o el disco local (STORAGE_DIR). */
    STORAGE_DRIVER: z.preprocess(emptyToUndefined, z.enum(["s3", "local"]).default("s3")),
    /** Carpeta de los archivos con STORAGE_DRIVER=local. */
    STORAGE_DIR: optionalString,
    // S3 variables are only required with STORAGE_DRIVER=s3 (see superRefine). Empty counts as
    // unset, so the empty S3_* lines of a .env don't break STORAGE_DRIVER=local.
    S3_ENDPOINT: s3EnvSchema.shape.S3_ENDPOINT,
    S3_REGION: z.preprocess(emptyToUndefined, s3EnvSchema.shape.S3_REGION.optional()),
    S3_FORCE_PATH_STYLE: s3EnvSchema.shape.S3_FORCE_PATH_STYLE,
    S3_BUCKET: z.preprocess(emptyToUndefined, s3EnvSchema.shape.S3_BUCKET.optional()),
    S3_ACCESS_KEY: z.preprocess(emptyToUndefined, s3EnvSchema.shape.S3_ACCESS_KEY.optional()),
    S3_SECRET_KEY: z.preprocess(emptyToUndefined, s3EnvSchema.shape.S3_SECRET_KEY.optional()),
    /** La app compilada (frontend/dist) que sirve la propia API; vacío: la sirve otro (Vite, Caddy). */
    APP_STATIC_DIR: optionalString,
    /** Saltos de proxy de confianza para la IP del cliente (1 detrás de Caddy; 0 expuesta directo). */
    TRUST_PROXY_HOPS: z.preprocess(
      emptyToUndefined,
      z.coerce.number().int().min(0).max(5).default(1),
    ),
    /** HTML → PDF para el PDF controlado (Gotenberg; solo red interna). Vacío: sin PDF de páginas. */
    GOTENBERG_URL: z.preprocess(emptyToUndefined, z.url().optional()),
    /** Versión vigente de los Términos y la Política de privacidad; al cambiarla se pide aceptar de nuevo. */
    TERMS_VERSION: z.preprocess(emptyToUndefined, z.string().min(1).max(40).default("2026-10-01")),
    SENTRY_DSN: z.preprocess(emptyToUndefined, z.url().optional()),
    /** Clave AES-256-GCM (32 bytes en base64) del SMTP propio de cada empresa. Obligatoria en producción. */
    EMAIL_ENCRYPTION_KEY: optionalString,
    /**
     * Clave AES-256-GCM (32 bytes en base64) del secreto de la verificación en dos pasos. Propia: no es la
     * del SMTP. Obligatoria en producción; sin ella la 2FA no está disponible (solo desarrollo).
     */
    MFA_ENCRYPTION_KEY: optionalString,
    /** Solo desarrollo y tests: permite SMTP en redes privadas (Mailpit). Nunca en producción. */
    EMAIL_ALLOW_PRIVATE_HOSTS: z.preprocess(
      emptyToUndefined,
      z
        .enum(["true", "false"])
        .default("false")
        .transform((value) => value === "true"),
    ),
    /** Proveedor de email para dominios verificados (fase B). Vacío: «próximamente». `memory` es solo de pruebas. */
    EMAIL_DOMAIN_PROVIDER: z.preprocess(emptyToUndefined, z.enum(["memory"]).optional()),
    /** Bian, el asistente IA. Apagado por defecto; si está habilitado, exige ANTHROPIC_API_KEY. */
    BIAN_ENABLED: z.preprocess(
      emptyToUndefined,
      z
        .enum(["true", "false"])
        .default("false")
        .transform((value) => value === "true"),
    ),
    ANTHROPIC_API_KEY: optionalString,
    /**
     * Folders with the installed plugins, comma-separated (default: plugins/ at the root). Relative
     * folders count from the repository root. In Docker, the ones built into the image and the plugins
     * volume (docs/spec/plugins.md).
     */
    PLUGINS_DIR: z.preprocess(
      emptyToUndefined,
      z
        .string()
        .optional()
        .transform((value) =>
          (value ?? "")
            .split(",")
            .map((dir) => dir.trim())
            .filter((dir) => dir !== "")
            .map((dir) => resolve(REPO_ROOT, dir)),
        )
        .pipe(z.array(z.string()).max(10)),
    ),
    /**
     * Folder where plugins uploaded from the app are installed (default: the last PLUGINS_DIR folder).
     * Relative to the repository root. In Docker, the plugins volume (/data/plugins).
     */
    PLUGIN_INSTALL_DIR: optionalString.transform((dir) =>
      dir === undefined ? undefined : resolve(REPO_ROOT, dir),
    ),
    /** Whether the owner can upload signed plugins (.sfplugin) from the app. On by default. */
    PLUGIN_UPLOAD_ENABLED: z.preprocess(
      emptyToUndefined,
      z
        .enum(["true", "false"])
        .default("true")
        .transform((value) => value === "true"),
    ),
    /** Ask GitHub once a day whether there's a newer version, to tell the owner (on by default). */
    UPDATE_CHECK: z.preprocess(
      emptyToUndefined,
      z
        .enum(["true", "false"])
        .default("true")
        .transform((value) => value === "true"),
    ),
    /** This installation's version: the image sets it; «dev» when running from source. */
    SPIDERFOLIO_VERSION: z.preprocess(emptyToUndefined, z.string().default("dev")),
    /**
     * The process runs under something that starts it again when it exits (Docker's restart policy,
     * the dev watcher): only then the app offers «Restart now» (docs/spec/plugins.md).
     */
    SPIDERFOLIO_SUPERVISED: z.preprocess(
      emptyToUndefined,
      z
        .enum(["true", "false"])
        .default("false")
        .transform((value) => value === "true"),
    ),
    /** Paquetes npm de plugins (privados), separados por comas. */
    PLUGIN_PACKAGES: z.preprocess(
      emptyToUndefined,
      z
        .string()
        .optional()
        .transform((value) =>
          (value ?? "")
            .split(",")
            .map((name) => name.trim())
            .filter((name) => name !== ""),
        )
        .pipe(z.array(z.string().regex(/^(@[a-z0-9-]+\/)?[a-z0-9][a-z0-9._-]*$/u)).max(50)),
    ),
  })
  .superRefine((env, ctx) => {
    if (env.STORAGE_DRIVER === "s3") {
      // Ya vienen validadas (y transformadas) por el esquema: solo se exige que estén.
      const required = ["S3_REGION", "S3_BUCKET", "S3_ACCESS_KEY", "S3_SECRET_KEY"] as const;
      for (const key of required.filter((name) => env[name] === undefined)) {
        ctx.addIssue({ code: "custom", path: [key], message: "Obligatoria con STORAGE_DRIVER=s3" });
      }
    } else if (env.STORAGE_DIR === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["STORAGE_DIR"],
        message: "Obligatoria con STORAGE_DRIVER=local",
      });
    }
    if (env.BIAN_ENABLED && env.ANTHROPIC_API_KEY === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["ANTHROPIC_API_KEY"],
        message: "Obligatoria si BIAN_ENABLED=true",
      });
    }
    if (env.EMAIL_DOMAIN_PROVIDER === "memory" && env.NODE_ENV === "production") {
      ctx.addIssue({
        code: "custom",
        path: ["EMAIL_DOMAIN_PROVIDER"],
        message: "El proveedor de memoria no se permite en producción",
      });
    }
    const key = env.EMAIL_ENCRYPTION_KEY;
    if (key === undefined) {
      if (env.NODE_ENV === "production") {
        ctx.addIssue({
          code: "custom",
          path: ["EMAIL_ENCRYPTION_KEY"],
          message: "Obligatoria en producción",
        });
      }
    } else if (!/^[A-Za-z0-9+/]{43}=$/.test(key) || Buffer.from(key, "base64").length !== 32) {
      ctx.addIssue({
        code: "custom",
        path: ["EMAIL_ENCRYPTION_KEY"],
        message: "Debe ser de 32 bytes en base64",
      });
    }
    const mfaKey = env.MFA_ENCRYPTION_KEY;
    if (mfaKey === undefined) {
      if (env.NODE_ENV === "production") {
        ctx.addIssue({
          code: "custom",
          path: ["MFA_ENCRYPTION_KEY"],
          message: "Obligatoria en producción",
        });
      }
    } else if (
      !/^[A-Za-z0-9+/]{43}=$/.test(mfaKey) ||
      Buffer.from(mfaKey, "base64").length !== 32
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["MFA_ENCRYPTION_KEY"],
        message: "Debe ser de 32 bytes en base64",
      });
    } else if (mfaKey === env.EMAIL_ENCRYPTION_KEY) {
      ctx.addIssue({
        code: "custom",
        path: ["MFA_ENCRYPTION_KEY"],
        message: "Tiene que ser distinta de EMAIL_ENCRYPTION_KEY",
      });
    }
    if (env.EMAIL_ALLOW_PRIVATE_HOSTS && env.NODE_ENV === "production") {
      ctx.addIssue({
        code: "custom",
        path: ["EMAIL_ALLOW_PRIVATE_HOSTS"],
        message: "No se permite en producción",
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((issue) => issue.path.join(".")))];
    throw new Error(`Variables de entorno inválidas o faltantes: ${fields.join(", ")}`);
  }
  return parsed.data;
}
