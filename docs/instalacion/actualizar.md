English version: [docs/install/upgrading.md](../install/upgrading.md)

# Actualizar SpiderFolio

Un solo comando, desde la carpeta de la instalación (donde están `.env` y `compose.yaml`). Guía completa:
[Actualizar](https://spiderfolio.spiderjad.com/es/docs/actualizaciones).

| Windows (PowerShell) | Linux |
| --- | --- |
| `powershell -ExecutionPolicy Bypass -File .\update.ps1` | `./update.sh` |
| `.\update.ps1 0.5.1` (una versión concreta) | `./update.sh 0.5.1` |

Instalaciones anteriores a la 0.5.0 no traen el script: descárgalo una vez de
[`deploy/update.ps1`](../../deploy/update.ps1) o [`deploy/update.sh`](../../deploy/update.sh).

## Qué hace

1. Averigua la versión (la última, o la indicada); si ya la tienes, termina.
2. **Antes de tocar nada**, baja la imagen nueva y revisa con ella los plugins instalados
   (`backend/scripts/check-plugins.ts`). Si alguno no funcionaría, se detiene y dice cuál y por qué.
3. Hace una copia de seguridad (`backup.ps1` / `backup.sh`) en `backups/`.
4. Trae los archivos de la versión nueva encima de la carpeta. Nunca toca `.env`, `backups/` ni los
   datos. Un `Caddyfile` con cambios se conserva (el nuevo queda en `Caddyfile.new`); un `compose.yaml`
   con cambios se guarda como `compose.yaml.bak-<fecha>`.
5. Agrega a `.env` las variables nuevas de `.env.example`, sin cambiar las que ya tienes, y dice cuáles.
6. Si `SPIDERFOLIO_IMAGE` tenía una versión fija, la cambia a la nueva (con `latest` la deja, salvo que
   pidas una versión que no es la última).
7. `docker compose pull` y `docker compose up -d` (nunca `down -v`); las migraciones corren solas.
8. Espera a que la app responda y muestra la versión que quedó.

## Volver atrás

Al terminar, el script muestra los dos pasos con los datos ya puestos:

1. En `.env`, `SPIDERFOLIO_IMAGE` de vuelta a la versión anterior.
2. `restore.ps1` / `./restore.sh` con la carpeta de la copia que hizo (detiene la app, recupera la base y
   los archivos y vuelve a arrancar con la imagen anterior; lo hecho después se pierde).

## Aviso de versión nueva

El propietario ve en Administración «Hay una versión nueva de SpiderFolio». El servidor consulta GitHub
una vez por día, sin enviar datos; `UPDATE_CHECK=false` en `.env` lo apaga.

Si compilas la imagen tú (por ejemplo, con plugins): `docker compose build && docker compose up -d`.
