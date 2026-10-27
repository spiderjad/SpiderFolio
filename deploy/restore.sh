#!/bin/sh
# Restaura una copia hecha con backup.sh (docs/instalacion/copias-de-seguridad.md). REEMPLAZA la base y
# los archivos actuales. Correr desde deploy/ con los servicios creados (docker compose up -d).
#   ./restore.sh ./backups/20261026-030000
set -eu
SRC="${1:?Indicá la carpeta de la copia}"
[ -f "$SRC/db.dump" ] && [ -f "$SRC/files.tar.gz" ] || { echo "No es una copia de backup.sh" >&2; exit 1; }
POSTGRES_USER="$(grep -E '^POSTGRES_USER=' .env | cut -d= -f2- || true)"
POSTGRES_DB="$(grep -E '^POSTGRES_DB=' .env | cut -d= -f2- || true)"
POSTGRES_USER="${POSTGRES_USER:-spiderfolio}"
POSTGRES_DB="${POSTGRES_DB:-spiderfolio}"

printf "Esto reemplaza la base y los archivos actuales por los de %s. Escribí RESTAURAR para seguir: " "$SRC"
read -r answer
[ "$answer" = "RESTAURAR" ] || { echo "Cancelado"; exit 1; }

echo "→ Deteniendo la app y el worker…"
docker compose stop app worker

echo "→ Base de datos…"
docker compose exec -T db dropdb -U "$POSTGRES_USER" --if-exists "$POSTGRES_DB"
docker compose exec -T db createdb -U "$POSTGRES_USER" "$POSTGRES_DB"
docker compose exec -T db pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner < "$SRC/db.dump"

echo "→ Archivos…"
docker compose run --rm --no-deps -T --entrypoint sh app -c 'rm -rf /data/files/* /data/files/.[!.]* 2>/dev/null; tar -C /data/files -xzf -' < "$SRC/files.tar.gz"

echo "→ Arrancando…"
docker compose up -d
echo "Restauración terminada. Revisa la app y el registro de auditoría."
