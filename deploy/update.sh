#!/bin/sh
# Updates SpiderFolio in one command (docs/instalacion/actualizar.md). Run it from the installation
# folder (where compose.yaml is):
#   ./update.sh            the latest version
#   ./update.sh 0.5.1      that version
# In order: checks the installed plugins with the new version (and stops if one won't load, before
# touching anything), makes a backup (backup.sh), puts the new version's files over this folder
# (never .env, backups/ or the data), adds to .env the variables the new version brings (never
# changing yours), pins SPIDERFOLIO_IMAGE to the new version if it had a fixed one, and runs
# docker compose pull and up -d. Never down -v. At the end, how to go back.
set -eu
cd "$(dirname "$0")"
REPO="spiderjad/SpiderFolio"

fail() { echo "ERROR: $*" >&2; exit 1; }
[ -f .env ] && [ -f compose.yaml ] || fail "Corre el script desde la carpeta de la instalación (donde están .env y compose.yaml)."
for tool in docker curl tar; do command -v "$tool" > /dev/null || fail "Falta $tool."; done

envValue() { grep -E "^$1=" .env | tail -n 1 | cut -d= -f2- || true; }
# a >= b, as versions (X.Y.Z)
atLeast() { [ "$(printf '%s\n%s\n' "$2" "$1" | sort -t. -k1,1n -k2,2n -k3,3n | head -n 1)" = "$2" ]; }

# ─── Which version ───────────────────────────────────────────────────────────
LATEST="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
  | sed -n 's/.*"tag_name": *"v\([0-9][0-9.]*\)".*/\1/p' | head -n 1)" || true
VERSION="${1:-$LATEST}"
VERSION="${VERSION#v}"
echo "$VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' \
  || fail "No sé qué versión instalar (¿hay conexión a internet?). Indícala: ./update.sh 0.5.1"
CURRENT="$(docker compose exec -T app printenv SPIDERFOLIO_VERSION 2>/dev/null | tr -d '\r' || true)"
[ -n "$CURRENT" ] || CURRENT="desconocida"
# For going back: the version to put again in SPIDERFOLIO_IMAGE.
PREVIOUS="$CURRENT"
echo "$PREVIOUS" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || PREVIOUS="<la versión que tenías>"
echo "Versión actual: $CURRENT  →  nueva: $VERSION"
if [ "$CURRENT" = "$VERSION" ]; then
  echo "Ya tienes la $VERSION. No hay nada que hacer."
  exit 0
fi

IMAGE="$(envValue SPIDERFOLIO_IMAGE)"
[ -n "$IMAGE" ] || IMAGE="ghcr.io/spiderjad/spiderfolio:latest"
BASE="${IMAGE%:*}"
TAG="${IMAGE##*:}"
NEW_IMAGE="$BASE:$VERSION"

# ─── 1. The new image and the plugins, before touching anything ──────────────
echo "→ Descargando la imagen $NEW_IMAGE…"
SPIDERFOLIO_IMAGE="$NEW_IMAGE" docker compose pull app || fail "No se pudo descargar $NEW_IMAGE."
if atLeast "$VERSION" "0.5.0"; then
  echo "→ Comprobando los plugins instalados con la $VERSION…"
  set +e
  SPIDERFOLIO_IMAGE="$NEW_IMAGE" docker compose run --rm --no-deps -T --entrypoint node app \
    backend/scripts/check-plugins.ts
  CHECK=$?
  set -e
  if [ "$CHECK" -ne 0 ]; then
    echo ""
    echo "ALTO: con la $VERSION, los plugins marcados con NO dejarían de funcionar." >&2
    echo "No se cambió nada. Pide versiones compatibles de esos plugins (o quítalos en" >&2
    echo "Administración › Plugins › Licencia y plugins) y vuelve a correr el script." >&2
    exit 1
  fi
else
  echo "(La $VERSION no trae la comprobación de plugins: se omite.)"
fi

# ─── 2. Backup ───────────────────────────────────────────────────────────────
echo "→ Copia de seguridad…"
./backup.sh
BACKUP="$(ls -1d ./backups/*/ 2>/dev/null | sort | tail -n 1)"
BACKUP="${BACKUP%/}"

# ─── 3. The new version's files over this folder ────────────────────────────
echo "→ Descargando los archivos de la $VERSION…"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
curl -fsSL "https://github.com/$REPO/releases/download/v$VERSION/spiderfolio-deploy.tar.gz" \
  -o "$WORK/bundle.tar.gz" || fail "No se pudo descargar el paquete de la $VERSION."
tar -xzf "$WORK/bundle.tar.gz" -C "$WORK"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
for file in "$WORK"/spiderfolio/* "$WORK"/spiderfolio/.env.example; do
  [ -f "$file" ] || continue
  name="$(basename "$file")"
  case "$name" in .env | backups) continue ;; esac
  if [ "$name" = "Caddyfile" ] && [ -f Caddyfile ] && ! cmp -s Caddyfile "$file"; then
    # Your Caddyfile has changes: it stays, and the new one is left next to it.
    cp "$file" Caddyfile.new
    echo "   Caddyfile: el tuyo tiene cambios y se mantiene; el nuevo quedó en Caddyfile.new."
    continue
  fi
  if [ "$name" = "compose.yaml" ] && [ -f compose.yaml ] && ! cmp -s compose.yaml "$file"; then
    cp compose.yaml "compose.yaml.bak-$STAMP"
  fi
  cp "$file" "$name"
done
chmod +x ./*.sh

# ─── 4. New variables in .env (never changing yours) ────────────────────────
ADDED=""
while IFS= read -r line; do
  key="$(printf '%s' "$line" | sed -n 's/^\([A-Z][A-Z0-9_]*\)=.*/\1/p')"
  [ -n "$key" ] || continue
  if ! grep -Eq "^$key=" .env; then
    [ -n "$ADDED" ] || printf '\n# Agregadas por update.sh (%s)\n' "$VERSION" >> .env
    printf '%s\n' "$line" >> .env
    ADDED="$ADDED $key"
  fi
done < .env.example
if [ -n "$ADDED" ]; then
  echo "   Variables nuevas agregadas a .env:$ADDED"
else
  echo "   .env: sin variables nuevas."
fi

# ─── 5. The image ────────────────────────────────────────────────────────────
setImage() {
  sed "s#^SPIDERFOLIO_IMAGE=.*#SPIDERFOLIO_IMAGE=$1#" .env > "$WORK/env" && cat "$WORK/env" > .env
  grep -Eq '^SPIDERFOLIO_IMAGE=' .env || printf 'SPIDERFOLIO_IMAGE=%s\n' "$1" >> .env
}
if echo "$TAG" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  setImage "$NEW_IMAGE"
  echo "   SPIDERFOLIO_IMAGE: $IMAGE → $NEW_IMAGE"
elif [ "$TAG" = "latest" ] && [ "$VERSION" != "$LATEST" ]; then
  # «latest» isn't the version asked for: it's pinned, or up -d would start another one.
  setImage "$NEW_IMAGE"
  echo "   SPIDERFOLIO_IMAGE: fijada en $NEW_IMAGE (pediste una versión que no es la última)."
fi

# ─── 6. Start it ─────────────────────────────────────────────────────────────
echo "→ docker compose pull y up -d…"
docker compose pull
docker compose up -d
echo "→ Esperando a que la app responda (aplica las migraciones al arrancar)…"
READY=""
i=0
while [ $i -lt 90 ]; do
  if docker compose exec -T app wget -qO- http://127.0.0.1:4000/api/health > /dev/null 2>&1; then
    READY="yes"
    break
  fi
  i=$((i + 1))
  sleep 2
done
RUNNING="$(docker compose exec -T app printenv SPIDERFOLIO_VERSION 2>/dev/null | tr -d '\r' || true)"

echo ""
if [ -n "$READY" ]; then
  echo "LISTO: SpiderFolio $RUNNING funcionando."
else
  echo "La app no respondió en 3 minutos. Mira qué pasa con: docker compose logs app" >&2
fi
cat <<EOF

Si algo salió mal, para volver a la versión anterior:
  1. En .env: SPIDERFOLIO_IMAGE=$BASE:$PREVIOUS
  2. ./restore.sh $BACKUP
     (vuelve a arrancar con esa imagen y la base como estaba antes de actualizar: lo hecho
     después se pierde)
EOF
[ -n "$READY" ] || exit 1
