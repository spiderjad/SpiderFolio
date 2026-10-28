#!/bin/sh
# Writes deploy/.env for a new installation: asks the minimum, generates the secrets and copies the
# rest from .env.example. Run it from deploy/: ./setup.sh (docs/instalacion/README.md).
set -eu
cd "$(dirname "$0")"

if [ -e .env ]; then
  echo "Ya existe .env: no se toca (tiene tus secretos). Para empezar de cero, renómbralo."
  echo ".env already exists: left untouched (it has your secrets). To start over, rename it."
  exit 1
fi
command -v openssl > /dev/null || { echo "Falta openssl / openssl is missing"; exit 1; }

ask() {
  # ask "question" default → answer (or the default when empty)
  printf '%s [%s]: ' "$1" "$2" >&2
  read -r answer || answer=""
  [ -n "$answer" ] || answer="$2"
  printf '%s' "$answer"
}

echo "¿Dónde lo vas a instalar? / Where will you install it?"
echo "  1) Probar en tu PC / Try it on your PC"
echo "  2) Servidor con dominio propio (HTTPS automático) / Server with your own domain (automatic HTTPS)"
echo "  3) Servidor con proxy propio / Server behind your own proxy"
MODE="$(ask "Opción / Option" 1)"

DOMAIN=""
PROFILES="mail"
SMTP_HOST="mailpit"
SMTP_PORT="1025"
SMTP_USER=""
SMTP_PASS=""
MAIL_FROM="SpiderFolio <no-reply@example.com>"
case "$MODE" in
  1) APP_URL="http://localhost:8080" ;;
  2)
    DOMAIN="$(ask "Dominio / Domain (docs.example.com)" "")"
    DOMAIN="$(printf '%s' "$DOMAIN" | sed -e 's#^https://##' -e 's#^http://##' -e 's#/.*$##')"
    [ -n "$DOMAIN" ] || { echo "Falta el dominio / Domain is required"; exit 1; }
    APP_URL="https://$DOMAIN"
    PROFILES="https"
    ;;
  3)
    APP_URL="$(ask "URL pública / Public URL (https://docs.example.com)" "")"
    APP_URL="${APP_URL%/}"
    case "$APP_URL" in https://* | http://*) ;; *) echo "La URL empieza con https:// / URL must start with https://"; exit 1 ;; esac
    PROFILES=""
    ;;
  *) echo "Opción no válida / Invalid option"; exit 1 ;;
esac

if [ "$MODE" != 1 ]; then
  echo "Servidor de email (SMTP) / Email server (SMTP)"
  SMTP_HOST="$(ask "SMTP host (smtp.example.com)" "")"
  SMTP_PORT="$(ask "SMTP port" 587)"
  SMTP_USER="$(ask "SMTP user" "")"
  printf 'SMTP password: ' >&2
  stty -echo 2> /dev/null || true
  read -r SMTP_PASS || SMTP_PASS=""
  stty echo 2> /dev/null || true
  echo >&2
  FROM="$(ask "Remitente / Sender (no-reply@example.com)" "no-reply@${DOMAIN:-example.com}")"
  MAIL_FROM="SpiderFolio <$FROM>"
fi

GOTENBERG_URL=""
PDF="$(ask "¿PDF de documentos controlados (Gotenberg, ~1 GB)? / Controlled-document PDF? (s/n)" n)"
case "$PDF" in
  s | S | y | Y | si | sí | yes)
    GOTENBERG_URL="http://gotenberg:3000"
    PROFILES="${PROFILES:+$PROFILES,}pdf"
    ;;
esac

# Hex for the database password: base64 has / and +, which break the database URL.
POSTGRES_PASSWORD="$(openssl rand -hex 24)"
JWT_ACCESS_SECRET="$(openssl rand -base64 48 | tr -d '\n')"
EMAIL_ENCRYPTION_KEY="$(openssl rand -base64 32)"
MFA_ENCRYPTION_KEY="$(openssl rand -base64 32)"

export APP_URL DOMAIN PROFILES SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASS MAIL_FROM GOTENBERG_URL
export POSTGRES_PASSWORD JWT_ACCESS_SECRET EMAIL_ENCRYPTION_KEY MFA_ENCRYPTION_KEY
umask 077
awk -v q="'" '
  function set(value) { print key "=" value; next }
  {
    key = $0
    sub(/=.*/, "", key)
  }
  /^#/ || !/=/ { print; next }
  key == "APP_URL" || key == "WEB_URL" { set(ENVIRON["APP_URL"]) }
  key == "DOMAIN" { set(ENVIRON["DOMAIN"]) }
  key == "COMPOSE_PROFILES" { set(ENVIRON["PROFILES"]) }
  key == "POSTGRES_PASSWORD" { set(ENVIRON["POSTGRES_PASSWORD"]) }
  key == "JWT_ACCESS_SECRET" { set(ENVIRON["JWT_ACCESS_SECRET"]) }
  key == "EMAIL_ENCRYPTION_KEY" { set(ENVIRON["EMAIL_ENCRYPTION_KEY"]) }
  key == "MFA_ENCRYPTION_KEY" { set(ENVIRON["MFA_ENCRYPTION_KEY"]) }
  key == "SMTP_HOST" { set(ENVIRON["SMTP_HOST"]) }
  key == "SMTP_PORT" { set(ENVIRON["SMTP_PORT"]) }
  key == "SMTP_USER" { set(ENVIRON["SMTP_USER"]) }
  # Single quotes: compose reads the value literally ($, # and spaces are common in passwords).
  key == "SMTP_PASS" { set(q ENVIRON["SMTP_PASS"] q) }
  key == "MAIL_FROM" { set("\"" ENVIRON["MAIL_FROM"] "\"") }
  key == "GOTENBERG_URL" { set(ENVIRON["GOTENBERG_URL"]) }
  { print }
' .env.example > .env
chmod 600 .env

echo
echo "Listo: .env creado. Guarda una copia en un lugar seguro."
echo "Done: .env created. Keep a copy somewhere safe."
echo
echo "Ahora / Now:  docker compose up -d"
echo "Después abre / Then open:  $APP_URL"
[ "$MODE" != 1 ] || echo "Emails de prueba / Test emails:  http://localhost:8025"
