Versión en español: [docs/instalacion/plugins.md](../instalacion/plugins.md)

# Commercial plugins

SpiderFolio is open source (AGPLv3) and works fully without plugins. Plugins add commercial features
(advanced security policies, import from OneDrive/SharePoint, MCP connector, industry templates, audit
rooms) and are activated with a license.

1. **Install the plugin**: copy its folder to `plugins/` (at the root of the repository) and build the
   image (`docker compose build && docker compose up -d`), or install it as an npm package and list it
   in `PLUGIN_PACKAGES`. Its migrations are applied automatically on startup.
2. **Load the license**: the company owner goes to Admin › License and plugins and pastes the license
   text (it starts with `SFL1.`). It is verified on your server, offline.

Without a license, or with an expired license, the plugin is not activated: SpiderFolio keeps working
the same and the plugin's settings are kept for when it is activated again.

Catalog and contact: the Plugins page on the project website.
