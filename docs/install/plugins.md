Versión en español: [docs/instalacion/plugins.md](../instalacion/plugins.md)

# Commercial plugins

SpiderFolio is open source (AGPLv3) and works fully without plugins. Plugins add commercial features
(advanced security policies, corporate directory, import from OneDrive/SharePoint, MCP connector,
industry templates, audit rooms) and are activated with a license.

## Install a plugin on a Docker installation

With `deploy/compose.yaml`, plugins live in the `plugins` volume (the `/data/plugins` folder of the app
and the worker). A plugin arrives **already built**: a folder with its `package.json`, without source
code. Nothing has to be built and no dependencies installed on your server.

1. Copy the plugin folder into the volume, from the `deploy/` folder:

   ```sh
   docker compose cp ./my-plugin app:/data/plugins/
   ```

   (`my-plugin` is an example: use the folder you received.)

2. Restart the app and the worker so they load it. Its migrations are applied automatically on startup:

   ```sh
   docker compose restart app worker
   ```

3. **Load the license**: the company owner goes to Admin › License and plugins and pastes the license
   text (it starts with `SFL1.`). It is verified on your server, offline.

The plugin shows up in License and plugins as installed. If it doesn't, check the app log
(`docker compose logs app`): a plugin that needs a newer version of SpiderFolio says so ("update
SpiderFolio").

**Update a plugin**: delete its folder from the volume, copy the new one and restart:

```sh
docker compose exec app rm -rf /data/plugins/my-plugin
docker compose cp ./my-plugin app:/data/plugins/
docker compose restart app worker
```

**Remove a plugin**: delete its folder and restart. Its data and settings stay in the database in case
you install it again.

When you update SpiderFolio (`docker compose pull && docker compose up -d`), the plugins in the volume
are kept. If you move the installation to another server, copy the plugins again: the backup keeps the
database and the files, not the plugins volume.

## Install from source (your own image)

If you build your own image, you can also put the plugin's source code in `plugins/` (at the root of
the repository) and build (`docker compose build && docker compose up -d`), or install it as an npm
package and list it in `PLUGIN_PACKAGES`. Every SpiderFolio update means building again.

## Without a license

Without a license, or with an expired license, the plugin is not activated: SpiderFolio keeps working
the same and the plugin's settings are kept for when it is activated again.

Catalog and contact: the Plugins page on the project website.
