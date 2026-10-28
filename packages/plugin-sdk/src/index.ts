// Contrato común de los plugins (docs/spec/plugins.md): el manifiesto que declara cada paquete y el
// formato de la licencia. Sin dependencias de Node ni del navegador: lo usan el backend, la app y las
// herramientas de firma.
import { z } from "zod";

/** Id de plugin: minúsculas, dígitos y guiones (ej. «security-policies»). */
export const PluginIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]{1,39}$/u, "Id de plugin: minúsculas, dígitos y guiones");
export type PluginId = z.infer<typeof PluginIdSchema>;

/**
 * Ids de los plugins comerciales de SpiderJAD: solo se activan con una licencia firmada. Un plugin
 * «community» no puede usar ninguno (así no se salta la licencia de uno comercial).
 */
export const COMMERCIAL_PLUGIN_IDS: readonly string[] = [
  "security-policies",
  "onedrive-import",
  "mcp-connector",
  "templates",
  "audit-rooms",
  "corporate-directory",
];

/**
 * Cómo se activa un plugin. «commercial» (por defecto): con una licencia firmada que lo incluya.
 * «community»: de terceros, sin licencia; aparece como «No verificado» y el propietario lo activa en
 * su empresa después de confirmar que tiene acceso al servidor.
 */
export const PluginDistributionSchema = z.enum(["commercial", "community"]);
export type PluginDistribution = z.infer<typeof PluginDistributionSchema>;

/**
 * Version of the plugin contract this core offers. It goes up when the SDK gains extension points; a
 * plugin declares the one it needs (`pluginApi`) and a core older than that doesn't load it.
 */
export const PLUGIN_API_VERSION = 1;

/**
 * Modules the app shares with built plugins (frontendBundle): the plugin marks them as external and
 * imports them from PLUGIN_SHARED_PATH + <file>.js, so it uses the app's own React, React Query, router
 * and components (one instance of each). Anything else the plugin bundles itself.
 */
export const PLUGIN_SHARED_MODULES = {
  react: "react",
  "react/jsx-runtime": "react-jsx-runtime",
  "@tanstack/react-query": "react-query",
  "react-router": "react-router",
  "@/plugins/ui": "ui",
  "@/plugins/locale": "locale",
} as const satisfies Record<string, string>;

/** Where the app serves the shared modules (same origin, not cached: they change with the core). */
export const PLUGIN_SHARED_PATH = "/plugin-shared/";

/** A path relative to the plugin package that stays inside it (no absolute paths, no «..»). */
const PackagePathSchema = z
  .string()
  .min(1)
  .max(200)
  .refine(
    (path) => !/^([a-zA-Z]:)?[\\/]/u.test(path) && !path.split(/[\\/]/u).includes(".."),
    "Path inside the plugin package",
  );

/**
 * What the plugin's package.json declares in its «spiderfolio» field. Paths are relative to the
 * package. `backend` and `frontend` are optional: a plugin can have only one of the two parts.
 * Unknown fields are ignored, so a newer manifest doesn't break an older core (`pluginApi` decides
 * whether it can load).
 */
export const PluginManifestSchema = z.object({
  id: PluginIdSchema,
  /** Nombre visible en español (el idioma de referencia). */
  name: z.string().min(1).max(80),
  description: z.string().max(400).default(""),
  /** Nombre y descripción en otros idiomas (ej. «en»); sin traducción se usan los de arriba. */
  translations: z
    .record(
      z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/u, "Idioma: «en», «pt-BR»…"),
      z.strictObject({
        name: z.string().min(1).max(80),
        description: z.string().max(400).default(""),
      }),
    )
    .default({}),
  /** Contract version the plugin needs (PLUGIN_API_VERSION); 1 if missing. */
  pluginApi: z.number().int().min(1).default(1),
  /** Backend entry: TypeScript source while developing, or the built ESM bundle (index.js). */
  backend: PackagePathSchema.optional(),
  /** App source (index.tsx), included when the app is built (development, own image). */
  frontend: PackagePathSchema.optional(),
  /**
   * App already built (ESM, docs/spec/plugins.md «Paquetes compilados»): the app loads it at runtime,
   * without rebuilding. Its folder is served as is, so it holds only what the browser needs.
   */
  frontendBundle: PackagePathSchema.optional(),
  /** Styles of the built app (CSS next to frontendBundle). */
  frontendStyles: PackagePathSchema.optional(),
  /** Carpeta con migraciones SQL propias (NNNN_nombre.sql), en el esquema plugin_<id>. */
  migrations: PackagePathSchema.optional(),
  distribution: PluginDistributionSchema.default("commercial"),
});
export type PluginManifest = z.infer<typeof PluginManifestSchema>;

/** Nombre y descripción del manifiesto en un idioma (los de referencia si no hay traducción). */
export function manifestText(
  manifest: Pick<PluginManifest, "name" | "description" | "translations">,
  locale: string,
): { name: string; description: string } {
  return (
    manifest.translations[locale] ?? { name: manifest.name, description: manifest.description }
  );
}

/** Esquema de Postgres de un plugin: plugin_<id con guiones bajos>. Fuera de Prisma. */
export function pluginSchemaName(id: PluginId): string {
  return `plugin_${id.replaceAll("-", "_")}`;
}

/**
 * Capacidad que agrega un plugin: «<id del plugin>:<nombre>» (ej. «audit-rooms:manage»). Las del
 * núcleo usan punto («members.view»), así nunca chocan.
 */
export type PluginCapabilityId = `${string}:${string}`;

export const PluginCapabilitySchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]{1,39}:[a-z][a-z0-9_.]{1,39}$/u, "Capacidad: <plugin>:<nombre>");

// ─── Licencia ───────────────────────────────────────────────────────────────

/** Prefijo y versión del formato: SFL1.<payload base64url>.<firma Ed25519 base64url>. */
export const LICENSE_PREFIX = "SFL1";

export const LicensePayloadSchema = z.strictObject({
  /** Id de la licencia (para soporte y revocación manual). */
  id: z.string().min(1).max(64),
  /** Empresa a la que se emitió. */
  customer: z.string().min(1).max(200),
  /** Plugins que activa. */
  plugins: z.array(PluginIdSchema).min(1).max(100),
  /** Fecha de emisión (ISO 8601). */
  issuedAt: z.iso.datetime(),
  /** Vencimiento (ISO 8601); null = sin vencimiento. */
  expiresAt: z.iso.datetime().nullable(),
});
export type LicensePayload = z.infer<typeof LicensePayloadSchema>;

export type LicenseStatus =
  | { state: "none" }
  | { state: "invalid"; reason: "format" | "signature" | "payload" }
  | { state: "expired"; payload: LicensePayload }
  | { state: "valid"; payload: LicensePayload };

/** base64url sin relleno, sin depender de Buffer (también corre en el navegador). */
export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function fromBase64Url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/u.test(text)) return null;
  const padded = text.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

/** Partes de un token de licencia, sin verificar la firma. null si el formato no es válido. */
export function splitLicense(
  token: string,
): { signed: Uint8Array; signature: Uint8Array; payloadJson: string } | null {
  const parts = token.trim().split(".");
  if (parts.length !== 3 || parts[0] !== LICENSE_PREFIX) return null;
  const [, payloadPart = "", signaturePart = ""] = parts;
  const payload = fromBase64Url(payloadPart);
  const signature = fromBase64Url(signaturePart);
  if (payload === null || signature === null || signature.length !== 64) return null;
  return {
    signed: new TextEncoder().encode(`${LICENSE_PREFIX}.${payloadPart}`),
    signature,
    payloadJson: new TextDecoder().decode(payload),
  };
}

/** El texto que se firma para un payload: SFL1.<payload base64url>. */
export function licenseSigningInput(payload: LicensePayload): string {
  const json = JSON.stringify(LicensePayloadSchema.parse(payload));
  return `${LICENSE_PREFIX}.${toBase64Url(new TextEncoder().encode(json))}`;
}
