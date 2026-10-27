#!/bin/sh
# Copia de seguridad de SpiderFolio (docs/instalacion/copias-de-seguridad.md): la base (pg_dump) y los
# archivos del volumen «files», en una carpeta con fecha. Correr desde deploy/ (donde está compose.yaml).
#   ./backup.sh [carpeta-destino]      (por defecto ./backups)
# Conserva las últimas KEEP copias (por defecto 14).
set -eu
DEST="${1:-./backups}"
KEEP="${KEEP:-14}"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
OUT="$DEST/$STAMP"
mkdir -p "$OUT"
# Variables de la base desde .env (sin exportar el resto).
POSTGRES_USER="$(grep -E '^POSTGRES_USER=' .env | cut -d= -f2- || true)"
POSTGRES_DB="$(grep -E '^POSTGRES_DB=' .env | cut -d= -f2- || true)"
POSTGRES_USER="${POSTGRES_USER:-spiderfolio}"
POSTGRES_DB="${POSTGRES_DB:-spiderfolio}"

echo "→ Base de datos…"
docker compose exec -T db pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner \
  > "$OUT/db.dump"

echo "→ Archivos…"
docker compose run --rm --no-deps -T --entrypoint tar app -C /data/files -czf - . > "$OUT/files.tar.gz"

echo "→ Configuración (.env, con permisos restringidos)…"
cp .env "$OUT/env"
chmod 600 "$OUT/env"

# Rotación: borra las copias más viejas.
ls -1d "$DEST"/*/ 2>/dev/null | sort | head -n "-$KEEP" | while read -r old; do rm -rf "$old"; done
echo "Copia lista en $OUT"
