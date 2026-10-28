Versión en español: [docs/instalacion/plugins.md](../instalacion/plugins.md)

# Commercial plugins

SpiderFolio is open source (AGPLv3) and works fully without plugins. Plugins add commercial features
(advanced security policies, corporate directory, import from OneDrive/SharePoint, MCP connector,
industry templates, audit rooms) and are activated with a license.

## Upload a plugin from the app

The simplest way: we send you a `.sfplugin` file with the plugin signed by SpiderJAD and your company's
license. You don't need to log in to the server.

1. The owner goes to Admin › License and plugins, copies the **Company ID** and sends it to us: the
   license is issued for that ID and only works in your company.
2. With the file we send you, on the same screen click **Choose .sfplugin file**. You need two-step
   verification turned on (My profile › Security); the app asks for your code.
3. The server checks the signature, that nothing was modified and that the license is your company's,
   and installs it. Click **Restart now**: the app and the worker restart in one minute, with a notice
   to everyone signed in so they save what they're editing.

If the server hosts several companies, the plugin is installed for the whole server (each company
activates it with its own license). Whoever runs the server can turn uploads off with
`PLUGIN_UPLOAD_ENABLED=false` in `.env`. Unsigned third-party plugins aren't uploaded from the app: they're
copied into the server's folder (below). Everything goes to the audit log.

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
