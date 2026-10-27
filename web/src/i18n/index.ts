// Textos de la web por idioma. Las páginas y componentes leen siempre `texts(locale)`.
import { en } from "./en/index.ts";
import { es } from "./es/index.ts";
import type { Locale } from "./locales.ts";
import type { Catalog } from "./types.ts";

export type Messages = Catalog<typeof es>;

const CATALOGS: Record<Locale, Messages> = { es, en };

export function texts(locale: Locale): Messages {
  return CATALOGS[locale];
}

export * from "./locales.ts";
export * from "./routes.ts";
