English version: [docs/install/plugins.md](../install/plugins.md)

# Plugins comerciales

SpiderFolio es open source (AGPLv3) y funciona completo sin plugins. Los plugins agregan funciones
comerciales (políticas de seguridad avanzadas, importación desde OneDrive/SharePoint, conector MCP,
plantillas por rubro, salas de auditoría) y se activan con una licencia.

1. **Instalar el plugin**: copia su carpeta a `plugins/` (en la raíz del repositorio) y compila la imagen
   (`docker compose build && docker compose up -d`), o instálalo como paquete npm y lístalo en
   `PLUGIN_PACKAGES`. Sus migraciones se aplican solas al arrancar.
2. **Cargar la licencia**: el propietario de la empresa entra a Administración › Licencia y plugins y pega
   el texto de la licencia (empieza con `SFL1.`). Se verifica en tu servidor, sin conexión.

Sin licencia, o con la licencia vencida, el plugin no se activa: SpiderFolio sigue funcionando igual y
los ajustes del plugin se conservan para cuando vuelva a activarse.

Catálogo y contacto: la página Plugins de la web del proyecto.
