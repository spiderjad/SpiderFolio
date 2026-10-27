English version: [docs/install/backups.md](../install/backups.md)

# Copias de seguridad y restauración

Una copia completa tiene tres partes: la base de datos, los archivos (volumen `files`, o tu bucket si
usas S3) y el `.env` (sin él no se pueden descifrar los secretos de 2FA ni los SMTP propios).

## Hacer una copia

```sh
cd spiderfolio/deploy
./backup.sh /ruta/de/copias      # por defecto ./backups; conserva las últimas 14 (KEEP=30 ./backup.sh …)
```

Crea `AAAAMMDD-HHMMSS/` con `db.dump` (pg_dump), `files.tar.gz` y `env` (permisos 600).

Programa una copia diaria con cron (`crontab -e`):

```cron
30 3 * * * cd /opt/spiderfolio/deploy && ./backup.sh /var/backups/spiderfolio >> /var/log/spiderfolio-backup.log 2>&1
```

Y lleva las copias **fuera del servidor** (otro disco, otro proveedor): una copia en el mismo disco no
protege de perder el servidor.

Con `STORAGE_DRIVER=s3`, el `files.tar.gz` queda vacío: activa el versionado del bucket o copia el bucket
con las herramientas del proveedor.

## Restaurar

```sh
cd spiderfolio/deploy
docker compose up -d                     # los servicios tienen que existir
./restore.sh /ruta/de/copias/20261026-033000
```

Pide confirmación escribiendo `RESTAURAR`, detiene la app, reemplaza la base y los archivos y vuelve a
arrancar. Si restauras en un servidor nuevo, copia antes el `env` de la copia como `.env`.

**Prueba la restauración** en un equipo aparte de vez en cuando: una copia que nunca se restauró no es
una copia.
