// Idiomas de la API, los emails y los PDF (docs/spec/i18n.md). El idioma vive en un
// AsyncLocalStorage: lo fija cada petición (cabecera Accept-Language que manda la app) o cada job
// (el del destinatario), y los textos de i18n/index.ts lo leen al usarse.
import { AsyncLocalStorage } from "node:async_hooks";

export const LOCALES = ["es", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "es";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** Idioma por defecto de una empresa (Workspace.settings.locale). */
export function readWorkspaceLocale(settings: unknown): Locale {
  const raw = (settings as { locale?: unknown } | null | undefined)?.locale;
  return isLocale(raw) ? raw : DEFAULT_LOCALE;
}

/** El de la persona si eligió uno; si no, el de su empresa. */
export function localeFor(userLocale: string | null | undefined, workspaceSettings: unknown): Locale {
  return isLocale(userLocale) ? userLocale : readWorkspaceLocale(workspaceSettings);
}

/** Primer idioma disponible de una cabecera Accept-Language (sin pesos: la app manda uno solo). */
export function localeFromHeader(header: string | undefined): Locale {
  for (const part of (header ?? "").split(",")) {
    const base = part.split(";")[0]?.trim().toLowerCase().split("-")[0];
    if (isLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}

const storage = new AsyncLocalStorage<Locale>();

export function currentLocale(): Locale {
  return storage.getStore() ?? DEFAULT_LOCALE;
}

export function withLocale<T>(locale: Locale, fn: () => T): T {
  return storage.run(locale, fn);
}
