# Despliegue de la web pública (Hostinger por FTP)

La web pública (`web/`: Astro estático, documentación en MDX y búsqueda con Pagefind) se publica en el
hosting compartido de Hostinger (Apache/LiteSpeed). No necesita Node en el servidor: GitHub Actions
compila `web/dist` y lo sube por FTP con el workflow `.github/workflows/deploy-web.yml`.

Esto es solo la web del proyecto. La app de cada empresa se instala aparte (ver `docs/instalacion/`).

## Qué hay en el repositorio

| Archivo                            | Para qué                                                                                                                                                                    |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.github/workflows/deploy-web.yml` | Compila la web y la sube por FTP con TLS (lftp) en cada push a `main` que toque la web.                                                                                     |
| `.nvmrc` (raíz)                    | Versión de Node del build en Actions.                                                                                                                                       |
| `web/public/.htaccess`             | Cabeceras de seguridad (CSP, nosniff, Referrer-Policy, X-Frame-Options, HSTS), caché, HTTPS, URLs sin `.html`, portada por idioma y redirecciones 301 de las URLs antiguas. |
| `web/public/lang-redirect.js`      | La portada `/` elige el idioma cuando el servidor no pudo (ver más abajo).                                                                                                  |
| `web/scripts/check-dist.ts`        | Corre en cada build: enlaces rotos, idiomas completos y que la CSP de `.htaccess` sea la de `web/csp.ts`.                                                                   |

Todo lo que está en `web/public/` se copia tal cual a `web/dist/`, así que `.htaccess` queda en la raíz
del sitio publicado.

## URLs

- Cada idioma tiene su prefijo: `/es/…` y `/en/…`, con slugs propios (`/es/instalacion` ↔
  `/en/install`, `/es/docs/crear-cuenta` ↔ `/en/docs/create-account`). El mapa está en
  `web/src/i18n/<idioma>/routes.ts`.
- URLs sin barra final ni `.html`: `/es/faq` se sirve desde `dist/es/faq.html`. `/es/faq.html` y
  `/es/faq/` redirigen (301) a `/es/faq`.
- `/` (portada): si el primer idioma del navegador (`Accept-Language`) es inglés o español, el servidor
  redirige (302) a `/en` o `/es`. Si no, `index.html` elige con JavaScript (idioma guardado en el
  selector o el primero de `navigator.languages` que exista) y, sin JavaScript, muestra un enlace a
  cada idioma. La portada no se indexa; el `x-default` de los hreflang apunta a la versión en español.
- URLs antiguas sin idioma (`/instalacion`, `/plugins`, `/seguridad`, `/faq`, `/docs`, `/docs/…`,
  `/legal/…`): 301 a `/es/…`.
- Una ruta que no existe bajo `/es` o `/en` muestra la 404 de ese idioma (`es/404.html`,
  `en/404.html`); fuera de ellas, `404.html`, con el texto en los dos idiomas. Usa `<If>` de Apache
  2.4.

## Puesta en marcha

### 1. Hosting

1. En hPanel, crea el sitio o subdominio y anota su carpeta (por ejemplo `/public_html` o
   `/public_html/spiderfolio`). La web tiene que quedar en la **raíz del dominio o subdominio**: las
   rutas y el `.htaccess` son absolutas desde `/`.
2. Activa el certificado SSL gratuito del dominio. El `.htaccess` ya fuerza HTTPS (también detrás del
   proxy de Hostinger, por `X-Forwarded-Proto`) y manda HSTS: actívalo solo con el certificado
   funcionando.
3. Crea una cuenta FTP con acceso solo a esa carpeta (**Archivos › Cuentas FTP**).

### 2. Secretos del repositorio

En GitHub: **Settings › Secrets and variables › Actions › New repository secret**.

| Secreto        | Ejemplo                     |
| -------------- | --------------------------- |
| `FTP_SERVER`   | `ftp.tudominio.com`         |
| `FTP_USERNAME` | el usuario de la cuenta FTP |
| `FTP_PASSWORD` | su contraseña               |
| `FTP_DIR`      | `/public_html/spiderfolio`  |

El workflow comprueba que estén los cuatro antes de subir. La contraseña no aparece en la línea de
comandos ni en el log (`lftp --env-password`).

Para las URLs canónicas, los hreflang y el sitemap, el build usa `WEB_SITE_URL`, definida en el paso
«Compilar la web» del workflow (`https://spiderfolio.spiderjad.com`; no es un secreto). Si cambia el
dominio, se cambia ahí, en `domain` de `web/src/config/site.ts` y en la línea `Sitemap:` de
`web/public/robots.txt`.

### 3. Publicar

- Automático: cada push a `main` que cambie `web/`, `packages/tailwind-preset/`, `brand/` o el propio
  workflow.
- A mano: **Actions › Publicar web › Run workflow**.

El workflow hace `npm ci`, `npm run build:web` (compila, verifica con `check-dist.ts` y genera el índice
de Pagefind) y `lftp mirror --reverse --delete web/dist/ $FTP_DIR`: el servidor queda igual que
`dist/`, incluido `.htaccess`, y se borra lo que ya no existe. Si el build o la verificación fallan, no
se sube nada. Un solo despliegue a la vez (`concurrency`).

No hay vistas previas por pull request: para revisar un cambio, `npm run build -w web` y
`npm run preview -w web` en local.

## `.htaccess`

- **Cabeceras** (`mod_headers`): la CSP es la de `web/csp.ts` (sin scripts ni estilos en línea;
  `'wasm-unsafe-eval'` solo para Pagefind). Si cambias una, cambia la otra: el build falla si no
  coinciden.
- **Caché**: los recursos con hash en el nombre (`/_astro/*.Ab12Cd34.js`, fuentes, CSS) se guardan un
  año como inmutables; el HTML, el JSON y el XML se revalidan en cada visita, así que un despliegue
  nuevo se ve al momento. Si activas la caché de LiteSpeed o el CDN de Hostinger, púrgala después de
  publicar.
- **Reescrituras** (`mod_rewrite`): HTTPS, URLs antiguas, portada por idioma, URLs canónicas sin
  `.html` ni barra final y, al final, `/es/x` → `es/x.html`. `DirectorySlash Off` evita que `/es`
  (que es `es.html` y también la carpeta `es/`) se redirija a `/es/`.
- Un error de sintaxis en `.htaccess` da 500 en todo el sitio: después de cambiarlo, revisa el sitio
  publicado.

## Comprobar un despliegue

- `curl -I https://tudominio.com/es` muestra la CSP, `X-Content-Type-Options` y `Referrer-Policy`.
- `curl -I -H "Accept-Language: en-US" https://tudominio.com/` responde 302 a `/en`.
- `/instalacion` y `/docs/miembros` redirigen con 301 a `/es/instalacion` y `/es/docs/miembros`.
- El selector de idioma de una guía lleva a la misma guía en el otro idioma.
- `https://tudominio.com/sitemap-index.xml` lista las páginas de los dos idiomas con sus alternativas.
- La búsqueda de la documentación (Ctrl+K) solo devuelve guías del idioma de la página.
