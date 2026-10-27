// Idiomas de la web pública (docs/spec/i18n.md). Para sumar uno (ej. pt-BR): su entrada aquí, sus
// textos en src/i18n/<idioma>/ (registrados en src/i18n/index.ts), su documentación en
// src/content/docs/<idioma>/ y nada más: astro.config.mjs lee esta lista.

export const LOCALES = ["es", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "es";

interface LocaleInfo {
  /** Nombre del idioma en ese mismo idioma (selector de idioma). */
  name: string;
  /** Valor de hreflang y del sitemap. */
  hreflang: string;
  /** Valor de og:locale. */
  ogLocale: string;
}

export const LOCALE_INFO: Record<Locale, LocaleInfo> = {
  es: { name: "Español", hreflang: "es", ogLocale: "es_ES" },
  en: { name: "English", hreflang: "en", ogLocale: "en_US" },
};

export function isLocale(value: string | undefined): value is Locale {
  return (LOCALES as readonly string[]).includes(value ?? "");
}

/** El idioma de una ruta (`/en/docs` → en), o el idioma por defecto si no lleva prefijo. */
export function localeOfPath(pathname: string): Locale {
  const first = pathname.split("/")[1];
  return isLocale(first) ? first : DEFAULT_LOCALE;
}
