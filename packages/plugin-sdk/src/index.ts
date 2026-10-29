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
 * Ids of SpiderJAD's official free plugins: signed by SpiderJAD, no license; the owner turns them on in
 * their company. Only they can declare «free», and a «community» plugin can't use one.
 */
export const OFFICIAL_FREE_PLUGIN_IDS: readonly string[] = ["microsoft-sign-in"];

/**
 * How a plugin is turned on. «commercial» (default): with a signed license that includes it. «free»:
 * official and free (OFFICIAL_FREE_PLUGIN_IDS), the owner turns it on in their company. «community»:
 * third-party, no license; it shows as «Not verified» and the owner turns it on after confirming they
 * have access to the server.
 */
export const PluginDistributionSchema = z.enum(["commercial", "free", "community"]);
export type PluginDistribution = z.infer<typeof PluginDistributionSchema>;

/**
 * Version of the plugin contract this core offers. It goes up when the SDK gains extension points; a
 * plugin declares the one it needs (`pluginApi`) and a core older than that doesn't load it.
 * 2: authProviders, ctx.secrets, ctx.directory and ctx.notify.
 * 3: «free» distribution, `replaces`, `guide`, shared sign-in providers (sharedWith) and ctx.shared.
 */
export const PLUGIN_API_VERSION = 3;

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
  /**
   * Official plugins this one replaces (pluginApi 3): while this one is on in a company, those stay
   * off there, and its providers declared `sharedWith` one of them use that plugin's data (settings,
   * secrets, linked accounts and sign-in address). If it goes off, the replaced one finds it all.
   */
  replaces: z.array(PluginIdSchema).max(5).default([]),
  /** The plugin's guide on the project's website (https), linked from License and plugins. */
  guide: z
    .url({ protocol: /^https$/u })
    .max(300)
    .optional(),
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

/**
 * What a license says. Unknown fields are ignored (the signature still covers them), so a newer license
 * with fields this core doesn't know still loads; only the fields below decide anything.
 */
export const LicensePayloadSchema = z.object({
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
  /**
   * Company (workspace id) the license belongs to. With it, the license only works in that company;
   * without it (older licenses), in whichever loads it. A signed plugin package always carries one.
   */
  workspaceId: z.string().min(1).max(64).optional(),
});
export type LicensePayload = z.infer<typeof LicensePayloadSchema>;

export type LicenseStatus =
  | { state: "none" }
  | { state: "invalid"; reason: "format" | "signature" | "payload" | "workspace" }
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

// ─── Signed plugin packages (.sfplugin) ─────────────────────────────────────

/**
 * A .sfplugin is a gzipped tar (ustar) with exactly: PACKAGE_MANIFEST_FILE, PACKAGE_SIGNATURE_FILE and
 * the built plugin under PACKAGE_FILES_PREFIX. The signature is Ed25519 over the manifest's bytes, as
 * they are in the file, with SpiderJAD's package key (base64url in PACKAGE_SIGNATURE_FILE).
 */
export const PACKAGE_MANIFEST_FILE = "manifest.json";
export const PACKAGE_SIGNATURE_FILE = "manifest.sig";
export const PACKAGE_FILES_PREFIX = "package/";
export const PACKAGE_FORMAT = "sfplugin/1";

/** Plugin versions in packages: plain x.y.z, so they can be compared (no downgrades). */
export const PluginVersionSchema = z
  .string()
  .regex(/^\d{1,6}\.\d{1,6}\.\d{1,6}$/u, "Versión x.y.z");

/** -1, 0 or 1, comparing x.y.z versions number by number. */
export function compareVersions(a: string, b: string): number {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference < 0 ? -1 : 1;
  }
  return 0;
}

/** The signed manifest: what the package holds, file by file, and the license it brings. */
export const PluginPackageManifestSchema = z.object({
  format: z.literal(PACKAGE_FORMAT),
  id: PluginIdSchema,
  version: PluginVersionSchema,
  /**
   * SFL1 license for the company that receives the package (it must name that workspaceId). An
   * official free plugin's package has none (null).
   */
  license: z.string().min(10).max(8000).nullable(),
  /** Every file under PACKAGE_FILES_PREFIX, with its path relative to it. */
  files: z
    .array(
      z.strictObject({
        path: PackagePathSchema,
        size: z.int().nonnegative(),
        sha256: z.string().regex(/^[0-9a-f]{64}$/u),
      }),
    )
    .min(1),
});
export type PluginPackageManifest = z.infer<typeof PluginPackageManifestSchema>;
