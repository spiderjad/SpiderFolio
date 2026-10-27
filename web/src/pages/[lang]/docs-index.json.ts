// Índice de la documentación de cada idioma para la búsqueda (Ctrl+K) cuando Pagefind no está
// disponible: Pagefind solo existe después de `npm run build`, así que en desarrollo (`astro dev`) la
// búsqueda usa /<idioma>/docs-index.json. Texto plano de cada guía: sin sintaxis de Markdown ni de MDX.
import type { APIRoute, GetStaticPaths } from "astro";
import { interpolateSite } from "../../config/site.ts";
import { LOCALES, docPath, type Locale } from "../../i18n/index.ts";
import { docRef } from "../../lib/docs.ts";

const files = import.meta.glob<string>("../../content/docs/*/*.mdx", {
  query: "?raw",
  import: "default",
  eager: true,
});

export const getStaticPaths = (() =>
  LOCALES.map((locale) => ({
    params: { lang: locale },
    props: { locale },
  }))) satisfies GetStaticPaths;

function plain(markdown: string): string {
  return markdown
    .replace(/^(import|export) .*$/gm, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*_>#|~]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Un valor del frontmatter (`title: "Texto"`). */
function field(frontmatter: string, name: string): string {
  const match = new RegExp(`^${name}:\\s*"?(.*?)"?\\s*$`, "m").exec(frontmatter);
  return match?.[1] ?? "";
}

export const GET: APIRoute<{ locale: Locale }> = ({ props }) => {
  const index = Object.entries(files).flatMap(([path, source]) => {
    const ref = docRef(path.replace(/^.*\/docs\//, "").replace(/\.mdx$/, ""));
    if (ref?.locale !== props.locale) return [];
    const parts = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(source.replace(/\r\n/g, "\n"));
    return [
      {
        url: docPath(ref.key, ref.locale),
        title: field(parts?.[1] ?? "", "title"),
        description: field(parts?.[1] ?? "", "description"),
        text: interpolateSite(plain(parts?.[2] ?? source)).replace(/[{}]/g, ""),
      },
    ];
  });
  return new Response(JSON.stringify(index), {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
};
