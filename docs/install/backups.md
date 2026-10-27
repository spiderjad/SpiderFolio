Versión en español: [docs/instalacion/copias-de-seguridad.md](../instalacion/copias-de-seguridad.md)

# Backups and restore

A full backup has three parts: the database, the files (the `files` volume, or your bucket if you use
S3) and `.env` (without it, the 2FA secrets and custom SMTP settings cannot be decrypted).

## Make a backup

```sh
cd spiderfolio/deploy
./backup.sh /path/to/backups     # ./backups by default; keeps the last 14 (KEEP=30 ./backup.sh …)
```

It creates `YYYYMMDD-HHMMSS/` with `db.dump` (pg_dump), `files.tar.gz` and `env` (permissions 600).

Schedule a daily backup with cron (`crontab -e`):

```cron
30 3 * * * cd /opt/spiderfolio/deploy && ./backup.sh /var/backups/spiderfolio >> /var/log/spiderfolio-backup.log 2>&1
```

And keep the backups **off the server** (another disk, another provider): a backup on the same disk does
not protect you from losing the server.

With `STORAGE_DRIVER=s3`, `files.tar.gz` is empty: turn on bucket versioning or copy the bucket with your
provider's tools.

## Restore

```sh
cd spiderfolio/deploy
docker compose up -d                     # the services must exist
./restore.sh /path/to/backups/20261026-033000
```

It asks you to confirm by typing `RESTAURAR`, stops the app, replaces the database and the files and
starts again. If you restore on a new server, first copy the backup's `env` as `.env`.

**Test the restore** on a separate machine from time to time: a backup that was never restored is not a
backup.
