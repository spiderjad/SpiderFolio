Versión en español: [docs/instalacion/actualizar.md](../instalacion/actualizar.md)

# Upgrade SpiderFolio

A single command, from the installation folder (where `.env` and `compose.yaml` are). Full guide:
[Update](https://spiderfolio.spiderjad.com/en/docs/updates).

| Windows (PowerShell) | Linux |
| --- | --- |
| `powershell -ExecutionPolicy Bypass -File .\update.ps1` | `./update.sh` |
| `.\update.ps1 0.5.1` (a specific version) | `./update.sh 0.5.1` |

Installations older than 0.5.0 don't include the script: download it once from
[`deploy/update.ps1`](../../deploy/update.ps1) or [`deploy/update.sh`](../../deploy/update.sh).

## What it does

1. Finds the version (the latest, or the one given); if you already have it, it stops.
2. **Before touching anything**, pulls the new image and checks the installed plugins with it
   (`backend/scripts/check-plugins.ts`). If one wouldn't work, it stops and says which one and why.
3. Makes a backup (`backup.ps1` / `backup.sh`) in `backups/`.
4. Brings the new version's files over the folder. It never touches `.env`, `backups/` or the data. A
   changed `Caddyfile` is kept (the new one goes to `Caddyfile.new`); a changed `compose.yaml` is saved as
   `compose.yaml.bak-<date>`.
5. Adds to `.env` the new variables from `.env.example`, never changing yours, and says which.
6. If `SPIDERFOLIO_IMAGE` had a fixed version, changes it to the new one (with `latest` it leaves it,
   unless you ask for a version that isn't the latest).
7. `docker compose pull` and `docker compose up -d` (never `down -v`); migrations run on their own.
8. Waits for the app to answer and shows the version running.

## Roll back

At the end the script shows the two steps with the details filled in:

1. In `.env`, `SPIDERFOLIO_IMAGE` back to the previous version.
2. `restore.ps1` / `./restore.sh` with the backup folder it made (it stops the app, brings the database and
   files back and starts again with the previous image; whatever was done after is lost).

## New version notice

The owner sees "There's a new version of SpiderFolio" in Administration. The server asks GitHub once a
day, sending no data; `UPDATE_CHECK=false` in `.env` turns it off.

If you build the image yourself (for example, with plugins): `docker compose build && docker compose up -d`.
