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
| Carpeta (cada subcarpeta es un plugin) | `PLUGINS_DIR` | `plugins/` en la raíz |
| Paquetes npm (privados), separados por comas | `PLUGIN_PACKAGES` | vacío |

- **Backend**: la API y el worker los descubren al arrancar (`backend/src/plugins/loader.ts`). El
  código corre con Node (TypeScript con tipos borrables). Un plugin que no carga o cuya migración falla
  queda fuera con un aviso en el log; el núcleo arranca igual.
- **App**: se incluyen al compilar con el módulo virtual `virtual:spiderfolio-plugins`
  (`frontend/plugins.vite.ts`). Instalar o quitar la parte de app de un plugin requiere volver a compilar
  la app (en Docker: reconstruir la imagen).

## Licencia

Formato: `SFL1.<payload base64url>.<firma base64url>`. La firma es Ed25519 sobre `SFL1.<payload>`.
Payload (`LicensePayloadSchema` en `@spiderfolio/plugin-sdk`):

```json
{ "id": "LIC-0001", "customer": "Embutidos Demo S.L.", "plugins": ["security-policies"],
  "issuedAt": "2026-10-26T00:00:00.000Z", "expiresAt": "2027-12-31T23:59:59.000Z" }
```

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
- Emisión: `plugins/tools/license.ts` (herramienta privada, no se publica). La clave privada vive fuera
  de cualquier repositorio.

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
| `security-policies` | Exigir 2FA a la empresa (gancho `mfaRequired`), dominios permitidos para invitar e importar (gancho `checkMemberEmail`), SSO (próximamente). Sección «Políticas avanzadas» del propietario. | Hecho, salvo SSO |
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
