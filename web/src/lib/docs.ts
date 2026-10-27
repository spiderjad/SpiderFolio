// Ubicación de cada guía de la colección docs: idioma, slug y clave del mapa de rutas.
// Archivo: src/content/docs/<idioma>/<slug>.mdx; la portada de cada idioma es index.mdx (slug "").
import { docKeyOf, isLocale, type DocKey, type Locale } from "../i18n/index.ts";

export interface DocRef {
  locale: Locale;
  slug: string;
  key: DocKey;
}

/** null si la guía no está en una carpeta de idioma o su slug no está en src/i18n/<idioma>/routes.ts. */
export function docRef(id: string): DocRef | null {
  const [locale, ...rest] = id.split("/");
  if (!isLocale(locale)) return null;
  const file = rest.join("/");
  const slug = file === "index" || file === "" ? "" : file;
  const key = docKeyOf(locale, slug);
  return key === undefined ? null : { locale, slug, key };
}
