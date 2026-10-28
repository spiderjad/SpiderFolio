// Única fuente del nombre, el titular, el dominio, el repositorio y el contacto en la web pública.
// Si cambia el dominio, el repositorio o el email de contacto, se cambian aquí y en ningún otro lugar. Layouts, componentes, MDX,
// metadatos SEO, sitemap y legales leen de este archivo.

export const SITE = {
  name: "SpiderFolio",
  domain: "spiderfolio.spiderjad.com",
  /** Titular del proyecto y de esta web, y responsable del tratamiento de sus datos (legales y pie). */
  owner: "Diego Pennisi",
  /** Organización o usuario de GitHub del repositorio público. */
  githubOrg: "spiderjad",
  /** Nombre del repositorio en GitHub (respeta mayúsculas). */
  githubRepo: "SpiderFolio",
  /** Email para reportar vulnerabilidades. */
  securityEmail: "security@spiderjad.com",
  /** Email de contacto (plugins, servicios y consultas). */
  contactEmail: "contacto@spiderjad.com",
} as const;

export const SITE_URL = `https://${SITE.domain}`;

/** Repositorio público: código, issues y la guía de instalación completa. */
export const REPO_URL = `https://github.com/${SITE.githubOrg}/${SITE.githubRepo}`;
export const DOCS_REPO_URL = `${REPO_URL}/tree/main/docs/instalacion`;

/**
 * Installation bundle of the latest Release, without a version number: GitHub resolves "latest" and
 * .github/workflows/release-bundle.yml attaches the bundle to every Release. Add .zip or .tar.gz.
 */
export const LATEST_BUNDLE_URL = `${REPO_URL}/releases/latest/download/spiderfolio-deploy`;

/** Email de contacto, o null mientras sea un marcador. */
export const CONTACT_EMAIL: string | null = /^[^\s@[\]]+@[^\s@[\]]+\.[^\s@[\]]+$/.test(
  SITE.contactEmail,
)
  ? SITE.contactEmail
  : null;

/** Reemplaza las referencias literales `SITE.name` y `SITE.domain` de textos que no pasan por MDX (p. ej. los encabezados de "En esta página"). */
export function interpolateSite(text: string): string {
  return text.replaceAll("SITE.name", SITE.name).replaceAll("SITE.domain", SITE.domain);
}

/** Last update of the legal pages (legal notice, privacy, terms and cookies), shown on each one and in the footer. */
export const LEGAL_UPDATED = new Date("2026-10-27T00:00:00Z");
