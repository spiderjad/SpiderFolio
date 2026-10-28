// Verificación del build (dist/). Falla si:
// - el HTML conserva un "SITE." literal (nombre sin interpolar) o un enlace con href vacío,
//   "undefined" o un esquema distinto de http, https o mailto;
// - un enlace interno (/…) lleva a una página que no existe (p. ej. una ruta sin prefijo de idioma);
// - falta alguna página del mapa de rutas en algún idioma (src/i18n/routes.ts);
// - una página de idioma no tiene <html lang> de su idioma o le faltan los hreflang (con x-default);
// - dist/.htaccess (public/.htaccess) no lleva exactamente la CSP de csp.ts;
// - an element keeps a style="" attribute (the CSP, style-src 'self', drops it), or a code color
//   class (cl-…, cd-…) has no rule in src/styles/code-theme.css (scripts/code-theme.ts).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { cspHeader } from "../csp.ts";
import { LOCALES, LOCALE_INFO } from "../src/i18n/locales.ts";
import { allAlternates } from "../src/i18n/routes.ts";

const dist = new URL("../dist", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const problems: string[] = [];
const codeTheme = readFileSync(new URL("../src/styles/code-theme.css", import.meta.url), "utf8");
const missingColors = new Set<string>();

function* htmlFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* htmlFiles(path);
    else if (entry.name.endsWith(".html")) yield path;
  }
}

/** ¿Se sirve algo en esta ruta? (build.format "file" y public/.htaccess: /es/faq → es/faq.html). */
function served(pathname: string): boolean {
  if (pathname === "/") return existsSync(join(dist, "index.html"));
  const target = join(dist, decodeURIComponent(pathname));
  return [`${target}.html`, join(target, "index.html"), target].some(
    (candidate) => existsSync(candidate) && statSync(candidate).isFile(),
  );
}

for (const file of htmlFiles(dist)) {
  const html = readFileSync(file, "utf8");
  const name = relative(dist, file).split(sep).join("/");
  if (/SITE\.[A-Za-z]/.test(html)) problems.push(`${name}: queda un "SITE." literal`);
  if (/<[a-z][^>]*\sstyle=/i.test(html)) {
    problems.push(`${name}: queda un atributo style="" (la CSP lo bloquea)`);
  }
  for (const match of html.matchAll(/\bclass="[^"]*"/g)) {
    for (const color of match[0].matchAll(/\bc[ld]-[0-9a-f]{3,8}\b/g)) {
      if (!codeTheme.includes(`.${color[0]} `)) missingColors.add(color[0]);
    }
  }
  for (const match of html.matchAll(/<a\b[^>]*?\shref=(?:"([^"]*)"|'([^']*)')/gi)) {
    const href = (match[1] ?? match[2] ?? "").trim();
    if (href === "" || /undefined|null/i.test(href)) {
      problems.push(`${name}: enlace con href inválido "${href}"`);
      continue;
    }
    const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(href)?.[1]?.toLowerCase();
    if (scheme && !["http", "https", "mailto"].includes(scheme)) {
      problems.push(`${name}: enlace con esquema no permitido "${href}"`);
    }
    if (href.startsWith("/") && !href.startsWith("//")) {
      const pathname = href.split(/[?#]/)[0] ?? "";
      if (!served(pathname))
        problems.push(`${name}: enlace interno a una página que no existe "${href}"`);
    }
  }

  // Páginas de idioma (no la portada ni las 404, que son noindex).
  const locale = LOCALES.find(
    (candidate) => name.startsWith(`${candidate}/`) || name === `${candidate}.html`,
  );
  if (locale === undefined || /(^|\/)404\.html$/.test(name)) continue;
  const lang = /<html\b[^>]*\slang="([^"]*)"/i.exec(html)?.[1];
  if (lang !== LOCALE_INFO[locale].hreflang)
    problems.push(`${name}: <html lang="${lang ?? ""}"> no es ${locale}`);
  for (const hreflang of [...LOCALES.map((other) => LOCALE_INFO[other].hreflang), "x-default"]) {
    if (!new RegExp(`<link[^>]+hreflang="${hreflang}"`, "i").test(html)) {
      problems.push(`${name}: falta <link rel="alternate" hreflang="${hreflang}">`);
    }
  }
}

for (const alternates of allAlternates()) {
  for (const locale of LOCALES) {
    if (!served(alternates[locale]))
      problems.push(`falta la página ${alternates[locale]} (src/i18n/routes.ts)`);
  }
}

const htaccess = join(dist, ".htaccess");
if (!existsSync(htaccess)) problems.push("falta dist/.htaccess (public/.htaccess)");
else {
  const csp = /^\s*Header always set Content-Security-Policy "([^"]+)"/m.exec(
    readFileSync(htaccess, "utf8"),
  )?.[1];
  if (csp !== cspHeader()) problems.push("la CSP de public/.htaccess no coincide con la de csp.ts");
}

for (const color of missingColors) {
  problems.push(`la clase de color ${color} no está en code-theme.css (node scripts/code-theme.ts)`);
}

if (problems.length > 0) {
  console.error(`Verificación del build fallida:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log(
  "Verificación del build correcta: sin «SITE.» literal ni enlaces rotos, rutas e idiomas completos, CSP de .htaccess igual a csp.ts, sin estilos en línea.",
);
