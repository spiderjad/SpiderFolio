English version: [docs/install/plugins.md](../install/plugins.md)

# Plugins comerciales

SpiderFolio es open source (AGPLv3) y funciona completo sin plugins. Los plugins agregan funciones
comerciales (políticas de seguridad avanzadas, directorio corporativo, importación desde
OneDrive/SharePoint, conector MCP, plantillas por rubro, salas de auditoría) y se activan con una
licencia.

## Subir un plugin desde la app

La forma más simple: te enviamos un archivo `.sfplugin` con el plugin firmado por SpiderJAD y la licencia
de tu empresa. No hace falta entrar al servidor.

1. El propietario entra a Administración › Licencia y plugins, copia el **ID de la empresa** y nos lo
   envía: la licencia se emite para ese ID y solo funciona en tu empresa.
2. Con el archivo que te enviamos, en la misma pantalla pulsa **Elegir archivo .sfplugin**. Necesitas
   tener activa la verificación en dos pasos (Mi perfil › Seguridad); la app te pide el código.
3. El servidor comprueba la firma, que nada se haya modificado y que la licencia sea de tu empresa, y lo
   instala. Pulsa **Reiniciar ahora**: la app y el worker se reinician en un minuto, con un aviso a
   todas las personas conectadas para que guarden lo que están editando.

Si el servidor tiene varias empresas, el plugin se instala para todo el servidor (cada empresa lo
activa con su propia licencia). Quien administra el servidor puede apagar la subida con
`PLUGIN_UPLOAD_ENABLED=false` en `.env`. Los plugins de terceros sin firma no se suben desde la app:
se copian en la carpeta del servidor (abajo). Todo queda en la auditoría.

## Instalar un plugin en una instalación con Docker

Con `deploy/compose.yaml`, los plugins viven en el volumen `plugins` (la carpeta `/data/plugins` de la
app y del worker). Un plugin llega **ya compilado**: una carpeta con su `package.json`, sin código
fuente. En tu servidor no hace falta compilar nada ni instalar dependencias.

1. Copia la carpeta del plugin al volumen, desde la carpeta `deploy/`:

   ```sh
   docker compose cp ./mi-plugin app:/data/plugins/
   ```

   (`mi-plugin` es un ejemplo: usa la carpeta que recibiste.)

2. Reinicia la app y el worker para que lo carguen. Sus migraciones se aplican solas al arrancar:

   ```sh
   docker compose restart app worker
   ```

3. **Carga la licencia**: el propietario de la empresa entra a Administración › Licencia y plugins y
   pega el texto de la licencia (empieza con `SFL1.`). Se verifica en tu servidor, sin conexión.

El plugin aparece en Licencia y plugins como instalado. Si no aparece, revisa el log de la app
(`docker compose logs app`): un plugin que necesita una versión más nueva de SpiderFolio lo dice
(«actualiza SpiderFolio»).

**Actualizar un plugin**: borra su carpeta del volumen, copia la nueva y reinicia:

```sh
docker compose exec app rm -rf /data/plugins/mi-plugin
docker compose cp ./mi-plugin app:/data/plugins/
docker compose restart app worker
```

**Quitar un plugin**: borra su carpeta y reinicia. Sus datos y ajustes quedan guardados en la base por
si vuelves a instalarlo.

Al actualizar SpiderFolio (`docker compose pull && docker compose up -d`), los plugins del volumen se
conservan. Si mudas la instalación a otro servidor, vuelve a copiar los plugins: la copia de seguridad
guarda la base y los archivos, no el volumen de plugins.

## Instalar desde el código (imagen propia)

Si compilas tu propia imagen, también puedes poner el código fuente del plugin en `plugins/` (en la
raíz del repositorio) y compilar (`docker compose build && docker compose up -d`), o instalarlo como
paquete npm y listarlo en `PLUGIN_PACKAGES`. Cada actualización de SpiderFolio pide volver a compilar.

## Sin licencia

Sin licencia, o con la licencia vencida, el plugin no se activa: SpiderFolio sigue funcionando igual y
los ajustes del plugin se conservan para cuando vuelva a activarse.

Catálogo y contacto: la página Plugins de la web del proyecto.
