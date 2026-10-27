// Mapa central de rutas por idioma: cada página y cada guía tiene una clave, y cada idioma define su
// slug en src/i18n/<idioma>/routes.ts. De aquí salen los enlaces internos, el selector de idioma, los
// hreflang y las alternativas del sitemap, así que un slug se cambia en un solo lugar.
import { routes as en } from "./en/routes.ts";
import { routes as es } from "./es/routes.ts";
import { LOCALES, type Locale } from "./locales.ts";

export const PAGE_KEYS = [
  "home",
  "install",
  "plugins",
  "security",
  "faq",
  "privacy",
  "terms",
  "cookies",
] as const;
export type PageKey = (typeof PAGE_KEYS)[number];

/** Guías de la documentación. El archivo de cada una es src/content/docs/<idioma>/<slug>.mdx. */
export const DOC_KEYS = [
  "intro",
  "install",
  "createAccount",
  "signIn",
  "browserRequirements",
  "home",
  "files",
  "members",
  "invitePeople",
  "departments",
  "rolesAndPermissions",
  "licenseAndPlugins",
  "limits",
  "configuration",
  "firstAdmin",
  "pages",
  "sharing",
  "controlledDocuments",
  "approvals",
  "requiredReading",
  "myDocuments",
  "qr",
  "search",
  "bian",
  "security2fa",
  "bianSetup",
  "smtp",
  "selfHostRequirements",
  "proxyHttps",
  "storage",
  "gotenberg",
  "backups",
  "updates",
  "troubleshooting",
  "architecture",
  "contributing",
  "createPlugin",
] as const;
export type DocKey = (typeof DOC_KEYS)[number];

export interface LocaleRoutes {
  /** Slug de cada página, sin el prefijo del idioma ("" = inicio). */
  pages: Record<PageKey, string>;
  /** Slug de cada guía dentro de /<idioma>/docs ("" = portada de la documentación). */
  docs: Record<DocKey, string>;
}

const ROUTES: Record<Locale, LocaleRoutes> = { es, en };

/** Rutas de una misma página en cada idioma. */
export type Alternates = Record<Locale, string>;

const join = (...parts: string[]): string => `/${parts.filter((part) => part !== "").join("/")}`;

export function pageSlug(key: PageKey, locale: Locale): string {
  return ROUTES[locale].pages[key];
}

export function pagePath(key: PageKey, locale: Locale, hash?: string): string {
  return join(locale, pageSlug(key, locale)) + (hash ? `#${hash}` : "");
}

export function docSlug(key: DocKey, locale: Locale): string {
  return ROUTES[locale].docs[key];
}

export function docPath(key: DocKey, locale: Locale): string {
  return join(locale, "docs", docSlug(key, locale));
}

const alternatesOf = (path: (locale: Locale) => string): Alternates =>
  Object.fromEntries(LOCALES.map((locale) => [locale, path(locale)])) as Alternates;

export function pageAlternates(key: PageKey): Alternates {
  return alternatesOf((locale) => pagePath(key, locale));
}

export function docAlternates(key: DocKey): Alternates {
  return alternatesOf((locale) => docPath(key, locale));
}

/** La guía de un archivo de la colección (`en/create-account` → createAccount). */
export function docKeyOf(locale: Locale, slug: string): DocKey | undefined {
  return DOC_KEYS.find((key) => ROUTES[locale].docs[key] === slug);
}

/** Todas las páginas y guías con sus rutas en cada idioma (sitemap y verificación del build). */
export function allAlternates(): Alternates[] {
  return [...PAGE_KEYS.map(pageAlternates), ...DOC_KEYS.map(docAlternates)];
}
