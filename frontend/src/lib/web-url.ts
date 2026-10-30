// Enlaces a la web pública (tudominio.com), que no comparte origen con la app. VITE_WEB_URL se
// fija al compilar (en producción, la WEB_URL del backend); sin ella, la web local de Astro.
const WEB_URL = (
  (import.meta.env.VITE_WEB_URL as string | undefined) ?? "http://localhost:4321"
).replace(/\/+$/, "");

export const legalUrl = {
  terms: `${WEB_URL}/legal/terminos`,
  privacy: `${WEB_URL}/legal/privacidad`,
};

/** Catálogo de plugins comerciales. */
export const pluginsUrl = `${WEB_URL}/plugins`;

export const docsUrl = `${WEB_URL}/docs`;

/** The «Update» guide, in the app's language. */
export const updateGuideUrl = (language: string): string =>
  language === "en" ? `${WEB_URL}/en/docs/updates` : `${WEB_URL}/es/docs/actualizaciones`;
