# Plugins

SpiderFolio es open source (AGPLv3). Las funciones comerciales viven en plugins que se instalan aparte
y se activan con una licencia firmada. Sin licencia válida el plugin no se activa y el núcleo funciona
igual: nada del núcleo depende de que un plugin esté. Los plugins de terceros pueden declararse
«community» y se activan sin licencia (ver «Plugins community»).

## Instalación

Un plugin es un paquete con `package.json` que declara el campo `spiderfolio`:

```json
{
  "name": "@empresa/plugin-ejemplo",
  "version": "0.1.0",
  "type": "module",
  "spiderfolio": {
    "id": "plugin-ejemplo",
    "name": "Plugin de ejemplo",
    "description": "Qué agrega el plugin.",
    "backend": "./backend/index.ts",
    "frontend": "./frontend/index.tsx",
    "migrations": "./migrations",
    "distribution": "commercial",
    "pluginApi": 1,
    "translations": {
      "en": { "name": "Sample plugin", "description": "What the plugin adds." }
    }
  }
}
```

`name` y `description` van en español; `translations` los da en otros idiomas, y la app muestra los del
idioma activo (sin traducción, los de referencia).

Se cargan de dos lugares:

| Origen | Variable | Por defecto |
|---|---|---|
| Carpetas separadas por comas (cada subcarpeta es un plugin) | `PLUGINS_DIR` | `plugins/` en la raíz; en la imagen, `/app/plugins,/data/plugins` |
| Paquetes npm (privados), separados por comas | `PLUGIN_PACKAGES` | vacío |

- **Backend**: la API y el worker los descubren al arrancar (`backend/src/plugins/loader.ts`). El
  código corre con Node (TypeScript con tipos borrables). Un plugin que no carga o cuya migración falla
  queda fuera con un aviso en el log; el núcleo arranca igual.
- **App**: dos formas. Desde su código (`frontend`), se incluyen al compilar con el módulo virtual
  `virtual:spiderfolio-plugins` (`frontend/plugins.vite.ts`): desarrollo o imagen propia, y cambiarlos
  requiere volver a compilar. Ya compilados (`frontendBundle`, ver «Paquetes compilados»), la app los
  carga al abrirse, sin recompilar: es lo que se instala en la imagen publicada. Si un plugin trae las
  dos, gana la compilada en la app.
- Un manifiesto ignora los campos que no conoce, así un plugin nuevo no rompe un núcleo viejo. Lo que
  decide si carga es `pluginApi` (por defecto 1): la versión del contrato que necesita. Si es mayor que
  `PLUGIN_API_VERSION` del núcleo, queda fuera con un aviso en el log («actualiza SpiderFolio»). Sube
  cuando el SDK gana puntos de extensión.
- Las rutas del manifiesto son relativas al paquete y no pueden salir de él (sin rutas absolutas ni `..`).

## Paquetes compilados

Lo que se instala en un servidor con la imagen publicada (`deploy/compose.yaml`): el plugin ya compilado,
sin código fuente ni `node_modules`. En el servidor nunca se corre `npm install` ni se compila nada.

```
mi-plugin/
  package.json        manifiesto: backend, frontendBundle, frontendStyles, migrations, pluginApi
  backend/index.js    un solo módulo ESM con todas sus dependencias adentro (solo módulos de Node afuera)
  app/index.js        la parte de app (ESM), y los fragmentos que importe, en la misma carpeta
  app/index.css       sus estilos: solo las utilidades que usa, sin el reset base (ya lo pone la app)
  migrations/         NNNN_nombre.sql
```

- **Dónde va**: en el volumen `plugins` (`/data/plugins` en la API y el worker, la misma carpeta para
  los dos). Se carga al reiniciar: `docker compose restart app worker`.
- **Backend**: la API importa `backend/index.js` como cualquier otro. Sin `node_modules` en el volumen,
  un import que no sea de Node falla y el plugin queda fuera.
- **App**: la API sirve la carpeta de `frontendBundle` en `/plugin-assets/<id>/` (mismo origen: la CSP no
  cambia; sin caché, la URL lleva `?v=<versión>`). `GET /api/v1/w/:slug/plugins` devuelve, por cada
  plugin activo, `bundle: { script, styles }`; la app agrega la hoja de estilos e importa el módulo, que
  tiene que exportar por defecto un `FrontendPlugin` con el id del manifiesto. Uno que falla queda fuera
  (aviso en la consola) y la app sigue. Esos archivos son públicos como el resto de la app: no llevan
  secretos; lo que protege es el backend (404 sin licencia).
- **Módulos compartidos**: el plugin no trae su propia copia de React, React Query, React Router ni de
  `@/plugins/ui` y `@/plugins/locale`: los marca como externos y los importa de
  `/plugin-shared/<archivo>.js` (`PLUGIN_SHARED_MODULES` y `PLUGIN_SHARED_PATH` del SDK). La app los
  genera en el mismo build (`dist/plugin-shared/`), así son las mismas instancias que usa ella. Lo demás
  (íconos, zod…) lo empaqueta el plugin.
- **Cómo se arma**: con cualquier empaquetador que respete lo anterior (por ejemplo, esbuild).
- En desarrollo (`npm run dev`) también cargan: Vite pasa `/plugin-assets` a la API y responde
  `/plugin-shared/<archivo>.js` con los mismos módulos que usa la app. Para trabajar en un plugin, lo
  cómodo sigue siendo su código fuente en `plugins/` (se recarga al guardar).

## Licencia

Formato: `SFL1.<payload base64url>.<firma base64url>`. La firma es Ed25519 sobre `SFL1.<payload>`.
Payload (`LicensePayloadSchema` en `@spiderfolio/plugin-sdk`):

```json
{ "id": "LIC-0001", "customer": "Embutidos Demo S.L.", "plugins": ["security-policies"],
  "issuedAt": "2026-10-26T00:00:00.000Z", "expiresAt": "2027-12-31T23:59:59.000Z",
  "workspaceId": "cmh…" }
```

- **Atada a la empresa**: `workspaceId` (opcional) es el id del workspace al que se emitió. Con él, la
  licencia solo vale en esa empresa: cargarla en otra se rechaza («es de otra empresa») y, si ya estaba
  cargada, queda como no válida (`reason: "workspace"`). Sin él (licencias anteriores), vale donde se cargue.
  El propietario ve el ID de su empresa en Licencia y plugins, con un botón para copiarlo y enviarlo.
- **Campos nuevos**: el núcleo ignora los campos que no conoce (la firma los cubre igual), así un núcleo
  futuro acepta licencias con más datos. Un núcleo anterior a este cambio rechaza una licencia con
  `workspaceId`: hay que actualizar el núcleo antes de cargar licencias nuevas.

- Se verifica **sin conexión** en cada uso (`backend/src/plugins/license.ts`) con la clave pública fija
  en `backend/src/plugins/license-key.ts`. Ninguna variable de entorno la reemplaza; los tests pasan otra
  clave por parámetro.
- Es por workspace (`WorkspaceLicense`): la carga el **propietario** en Administración › Licencia y
  plugins (`PUT /admin/license`). Se rechaza una licencia inválida o vencida. La auditoría guarda id,
  empresa, plugins y vencimiento, nunca el token.
- Activo = instalado **y** listado en una licencia válida y no vencida. La API y el worker recuerdan la
  licencia leída 30 s.
- Al vencer, el plugin se desactiva solo: sus rutas responden 404, sus jobs no corren, sus ganchos no se
  consultan y la app deja de mostrarlo. Sus datos y ajustes se conservan.
- Emisión: con una herramienta privada de SpiderJAD (no se publica). La clave privada vive fuera
  de cualquier repositorio.

## Subir un plugin desde la app

Además de copiar la carpeta al volumen, el **propietario** puede subir un plugin comercial firmado desde
Administración › Licencia y plugins. Los plugins community (sin firma) nunca se suben por la app: solo
copiándolos en la carpeta del servidor.

**El archivo `.sfplugin`** (`PluginPackageManifestSchema` del SDK): un tar ustar comprimido con gzip con
exactamente `manifest.json`, `manifest.sig` y el plugin compilado bajo `package/` (ver «Paquetes
compilados»). `manifest.json` trae el id, la versión `x.y.z`, la licencia de la empresa (SFL1) y la lista
de archivos con su tamaño y SHA-256. `manifest.sig` es la firma Ed25519 de SpiderJAD sobre los bytes de
`manifest.json`, con la **clave de paquetes** (`backend/src/plugins/package-key.ts`, distinta de la de
licencias y fija en el código como ella). Lo arma la herramienta privada de SpiderJAD.

**Se verifica todo en memoria antes de escribir nada** (`backend/src/plugins/package.ts`). Se rechaza si:

- no es un tar.gz válido, trae enlaces, dispositivos o extensiones PAX/GNU, rutas absolutas, con `..` o
  repetidas, o supera los topes de `pluginPackageLimits` (`packages/limits`: tamaño del archivo, tamaño
  descomprimido y cantidad de archivos);
- la firma no es válida, o algún archivo no coincide byte a byte con el manifiesto firmado, falta o sobra;
- el `package.json` del plugin no coincide con el manifiesto firmado (id, versión), no es comercial o
  necesita un `pluginApi` más nuevo que el del núcleo;
- la licencia no es válida, venció, no incluye el plugin o no es de la empresa que lo sube (en un
  paquete el `workspaceId` es obligatorio);
- ya hay instalada una versión más nueva (no se baja de versión, así no se reinstala una vieja con
  fallos), o el plugin viene incluido en la imagen (se actualiza con la imagen).

**Quién**: solo el propietario, con su verificación en dos pasos activa y confirmada hace poco
(`MFA_RECENT_REQUIRED`: la app pide el código y reintenta). El servidor puede apagar la subida con
`PLUGIN_UPLOAD_ENABLED=false` (encendida por defecto). Si el servidor tiene más de una empresa, la
pantalla avisa que el plugin se instala para todo el servidor; cada empresa lo activa con su licencia.

**Instalación** (`backend/src/plugins/install.ts`): en `PLUGIN_INSTALL_DIR` (en Docker, el volumen
`/data/plugins`; si falta, la última carpeta de `PLUGINS_DIR`). Se escribe en una carpeta oculta y se
cambia por la anterior con un `rename`, así el cargador nunca lee una a medias. La licencia que trae pasa
a ser la de la empresa si es más nueva (`issuedAt`) que la cargada. Se carga al reiniciar.

**Reiniciar ahora** (`backend/src/plugins/restart.ts`): solo si algo vuelve a levantar los procesos al
salir (`SPIDERFOLIO_SUPERVISED=true`: lo pone `deploy/compose.yaml`, y el watcher de `npm run dev`); si
no, la pantalla explica cómo reiniciar a mano. El propietario (con 2FA reciente) programa el reinicio:
se escribe `.restart.json` en la carpeta de instalación, que comparten la API y el worker. Desde ese
momento cada respuesta de la API lleva `X-SpiderFolio-Restart-At` y la app muestra a todas las personas
conectadas una cuenta regresiva para que guarden lo que están editando (`RESTART_NOTICE_MS`, 1 minuto).
A la hora, cada proceso deja de aceptar trabajo, termina lo que está haciendo (pedidos en curso, jobs) y
sale con el código 75; Docker (o el watcher) lo vuelve a levantar con los plugins nuevos. Un proceso
ignora los planes anteriores a su arranque, así no se reinicia dos veces.

**Auditoría**: `plugin.package.upload` (id, versión, versión anterior, licencia y si se actualizó),
`plugin.package.rejected` (el motivo) y `server.restart.request` (la hora y lo que espera cargarse).

## Plugins community

`distribution` del manifiesto: `"commercial"` (por defecto) o `"community"`.

- **Comercial**: activo con una licencia firmada que lo incluya (arriba). Los plugins de SpiderJAD son
  todos comerciales; sus ids están en `COMMERCIAL_PLUGIN_IDS` (`@spiderfolio/plugin-sdk`) y un manifiesto
  community con uno de esos ids no se carga (así no se salta la licencia).
- **Community**: de terceros, sin licencia. Instalado no se activa: el **propietario** lo activa por
  empresa en Licencia y plugins (`PUT /admin/plugins/:pluginId/activation` con
  `{ enabled: true, acceptRisk: true }`). La app lo marca «No verificado» y pide confirmar una advertencia
  (no está verificado y tiene acceso al servidor); sin `acceptRisk` la API responde 400. La activación
  vive en `Workspace.settings.communityPlugins` (fuera del alcance de los plugins, que no reciben Prisma)
  y se audita (`plugin.community.enable` / `plugin.community.disable`). Desactivado, se comporta como uno
  sin licencia.

## Puntos de extensión del backend

El backend del plugin exporta por defecto un `BackendPlugin` (`@spiderfolio/plugin-sdk/backend`):

| Campo | Qué hace |
|---|---|
| `routes` | Rutas de tenant en `/api/v1/w/:slug/plugins/<id>/…`, detrás de la misma cadena que las del núcleo (sesión, tenant, 2FA obligatoria, capacidades) y de `requirePluginActive` (404 si no está activo). El handler recibe un `PluginRequestContext`. |
| `jobs` | Colas `plugin.<id>.<job>` en el worker; con `cron`, corren una vez por cada workspace con la licencia vigente. Un job de un workspace donde el plugin dejó de estar activo se descarta. |
| `migrations` (manifiesto) | Archivos `NNNN_nombre.sql` aplicados en el esquema `plugin_<id>` (fuera de Prisma, así `prisma migrate diff` no ve deriva). Se registran en `plugins.migrations` con su checksum; una ya aplicada no se vuelve a correr. Lock de Postgres para que la API y el worker no se pisen. |
| `capabilities` | Capacidades `<id>:<nombre>` con su etiqueta. Se asignan en el editor de roles (grupo «Plugins»); el propietario las tiene todas. |
| `features` | Funciones que agrega; el núcleo pregunta con `plugins.hasFeature(workspaceId, f)`. |
| `i18n` | Textos del backend del plugin, un catálogo por idioma (`{ es, en }`). Se leen al usarlos con `localized(catalogs)` (o `pluginLocale()`), que sigue el idioma de la petición (`Accept-Language`) o del job (`es` si no hay); el núcleo lo conecta con `providePluginLocale` al arrancar. Etiquetas de capacidades traducidas: `get label()` / `get description()`. |
| `hooks` | Ganchos que consulta el núcleo: `mfaRequired` (exigir 2FA) y `checkMemberEmail` (antes de invitar o importar). |

El plugin **nunca recibe el cliente de Prisma**. Su contexto (`PluginWorkspaceContext`) trae:
`settings` (clave → JSON en `PluginSetting`, por workspace), `sql` (consultas parametrizadas en su
esquema), `logger` y `enqueue`. En un pedido además: quién es, sus capacidades, `audit` (acción
`plugin.<id>.<acción>`), `requireRecentMfa` y `hasOwnMfa`. El aislamiento entre empresas en su esquema es
responsabilidad del plugin: toda tabla lleva `workspace_id` y toda consulta filtra por
`ctx.workspaceId`.

Errores: `PluginError` con `BAD_REQUEST`, `FORBIDDEN`, `NOT_FOUND` o `CONFLICT`; el núcleo los traduce al
formato único. Los errores de Zod salen como `VALIDATION_ERROR`.

## Puntos de extensión de la app

El frontend del plugin exporta por defecto un `FrontendPlugin` (`@spiderfolio/plugin-sdk/frontend`):

| Campo | Dónde aparece |
|---|---|
| `navItems` | Menú lateral (a pantallas del plugin). |
| `screens` | `/app/:slug/p/<id>/<path>`. |
| `adminSections` | Panel de Administración, `/app/:slug/admin/p/<id>/<section>`. |
| `documentActions` | Menú «…» de una página abierta. |
| `explorerActions` | Menú de cada fila del explorador. |
| `folderActions` | Botón «Nuevo» del explorador. |

La app pide `GET /api/v1/w/:slug/plugins` (los activos) y solo muestra esos. Los plugins importan
componentes de `@/plugins/ui` (los mismos del núcleo) y nada más de la app. Idioma: `locale` de
`@/plugins/locale` (también en `@/plugins/ui`), ya fijado cuando se cargan los plugins; cada plugin
tiene sus textos `es` y `en` y elige con `locale === "en" ? en : es`. El `index.tsx` importa de
`@/plugins/locale`, no de `@/plugins/ui` (evita un ciclo con el registro).

## Repositorio

Los plugins comerciales están en `plugins/` (workspaces npm) solo mientras se desarrollan junto al
núcleo. `scripts/export-public.ts` genera el repositorio público sin esa carpeta. Para moverlos a un
repositorio privado: copiar `plugins/` y `packages/plugin-sdk` (o publicarlo como paquete privado) y
apuntar `PLUGINS_DIR` o `PLUGIN_PACKAGES` a donde queden instalados.

## Plugins comerciales

| Plugin | Qué agrega | Estado |
|---|---|---|
| `security-policies` | Exigir 2FA a la empresa (gancho `mfaRequired`) y dominios permitidos para invitar e importar (gancho `checkMemberEmail`). Sección «Políticas avanzadas» del propietario. | Hecho |
| `corporate-directory` | Directorio corporativo: inicio de sesión con Active Directory o Microsoft Entra ID, altas y sincronización de grupos. | En desarrollo |
| `onedrive-import` | Importar de OneDrive y SharePoint (botón Nuevo, job `sync`). | Esqueleto |
| `mcp-connector` | Conector MCP para Claude (spec en `plugins/mcp-connector/SPEC.md`). | Esqueleto |
| `templates` | Plantillas propias y por rubro (migración propia `plugin_templates`). | Esqueleto |
| `audit-rooms` | Salas de auditoría para auditores externos (acción en documentos). | Esqueleto |

Migración de datos: `20261117100000_security_policies_plugin` copia `settings.require2fa` y
`Workspace.allowedDomains` a `PluginSetting` (plugin `security-policies`) y después quita la clave y la
columna. Sin licencia, esos ajustes quedan guardados pero no se aplican; la pantalla «Licencia y plugins»
lo advierte.

La 2FA individual (activarla en el perfil, códigos de recuperación, dispositivos de confianza, reinicio por
un administrador) es del núcleo. La pantalla de activación obligatoria también: aparece cuando un plugin
activo la exige (MFA_SETUP_REQUIRED).
