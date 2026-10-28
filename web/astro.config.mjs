import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, passthroughImageService } from "astro/config";
import { DEFAULT_LOCALE, LOCALES, LOCALE_INFO } from "./src/i18n/locales.ts";
import { allAlternates } from "./src/i18n/routes.ts";
import { shikiStyleToClass } from "./src/lib/shiki-classes.ts";

// URL pública de la web (canónicas, hreflang y sitemap). WEB_SITE_URL la reemplaza (por ejemplo, para
// una copia de pruebas).
const site = process.env.WEB_SITE_URL ?? "https://spiderfolio.spiderjad.com";

// Alternativas de idioma de cada URL para el sitemap, desde el mapa central de rutas: las páginas
// tienen slugs distintos por idioma (/es/instalacion ↔ /en/install), así que la opción i18n de
// @astrojs/sitemap sola (que empareja rutas iguales) no alcanza.
const absolute = (path) => new URL(path, site).href;
const sitemapLinks = new Map();
for (const alternates of allAlternates()) {
  const links = [
    ...LOCALES.map((locale) => ({
      lang: LOCALE_INFO[locale].hreflang,
      url: absolute(alternates[locale]),
    })),
    { lang: "x-default", url: absolute(alternates[DEFAULT_LOCALE]) },
  ];
  for (const locale of LOCALES) sitemapLinks.set(absolute(alternates[locale]), links);
}

export default defineConfig({
  site,
  output: "static",
  // /es/instalacion → dist/es/instalacion.html: URLs sin barra final, y cada idioma tiene su
  // dist/<idioma>/404.html. En el hosting, public/.htaccess sirve /es/x desde es/x.html.
  trailingSlash: "never",
  build: { format: "file", inlineStylesheets: "never" },
  i18n: {
    locales: [...LOCALES],
    defaultLocale: DEFAULT_LOCALE,
    // La portada (/) es src/pages/index.astro: elige el idioma del navegador.
    routing: { prefixDefaultLocale: true, redirectToDefaultLocale: false },
  },
  integrations: [
    mdx(),
    sitemap({
      i18n: {
        defaultLocale: DEFAULT_LOCALE,
        locales: Object.fromEntries(
          LOCALES.map((locale) => [locale, LOCALE_INFO[locale].hreflang]),
        ),
      },
      // Sin la portada de idiomas (noindex) ni las páginas 404.
      filter: (page) => sitemapLinks.has(page.replace(/\/$/, "")),
      serialize: (item) => ({
        ...item,
        links: sitemapLinks.get(item.url.replace(/\/$/, "")) ?? item.links,
      }),
    }),
  ],
  // Code blocks with light and dark colors as classes, never inline styles (CSP style-src 'self'):
  // src/lib/shiki-classes.ts and src/styles/code-theme.css.
  markdown: {
    shikiConfig: {
      themes: { light: "github-light", dark: "github-dark" },
      defaultColor: false,
      transformers: [shikiStyleToClass],
    },
  },
  // Sin optimización de imágenes (no hace falta sharp ni sus scripts de instalación).
  image: { service: passthroughImageService() },
  vite: {
    // Las variables PUBLIC_ se leen del .env de la raíz del repo (solo se exponen esas).
    envDir: "..",
    plugins: [tailwindcss()],
    // Sin scripts ni assets incrustados: permite una CSP sin 'unsafe-inline' en scripts.
    build: { assetsInlineLimit: 0 },
  },
});
