4. Variables de entorno (.env.example)
NODE_ENV=development
PORT=4000
APP_URL=http://localhost:5173          # en producción: https://app.tudominio.com
WEB_URL=http://localhost:4321          # en producción: https://tudominio.com
# Web pública (se fija al compilar): PUBLIC_APP_URL = URL de la app; todos los enlaces a /register y /login salen de ahí. Por defecto http://localhost:5173; en producción https://app.tudominio.com
PUBLIC_APP_URL=http://localhost:5173
# Frontend (se fija al compilar la app): VITE_WEB_URL = la misma WEB_URL; los enlaces a /legal/terminos y /legal/privacidad salen de ahí
JWT_ACCESS_SECRET=                     # mínimo 64 caracteres aleatorios
JWT_ACCESS_TTL=15m
REFRESH_TTL_DAYS=30
DATABASE_URL=postgresql://spiderfolio:spiderfolio@localhost:5432/spiderfolio
SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_USER=
SMTP_PASS=
MAIL_FROM="SpiderFolio <no-reply@tudominio.com>"
STORAGE_DRIVER=s3                 # s3 o local (disco en STORAGE_DIR; las URLs firmadas las sirve la API en /api/v1/storage)
STORAGE_DIR=                       # con STORAGE_DRIVER=local
S3_ENDPOINT=http://localhost:9000
S3_REGION=auto
S3_FORCE_PATH_STYLE=true                # true en RustFS local; R2 funciona con ambos
S3_BUCKET=spiderfolio-files
S3_SYSTEM_BUCKET=spiderfolio-files-system
S3_ACCESS_KEY=
S3_SECRET_KEY=
# Gotenberg (HTML → PDF del PDF controlado); solo red interna. Vacío: sin PDF de páginas (la app lo avisa).
GOTENBERG_URL=http://127.0.0.1:3000
APP_STATIC_DIR=                    # la app compilada que sirve la propia API (imagen de Docker: /app/frontend/dist)
TRUST_PROXY_HOPS=1                 # saltos de proxy de confianza para la IP del cliente
TERMS_VERSION=2026-10-01          # versión vigente de Términos y Privacidad; al cambiarla se pide aceptar de nuevo
SENTRY_DSN=
EMAIL_ENCRYPTION_KEY=              # clave AES-256-GCM (32 bytes en base64) del SMTP propio por empresa; obligatoria en producción
MFA_ENCRYPTION_KEY=                # clave AES-256-GCM (32 bytes en base64) del secreto de la 2FA; propia y distinta de EMAIL_ENCRYPTION_KEY; obligatoria en producción
EMAIL_ALLOW_PRIVATE_HOSTS=false    # solo desarrollo y tests (Mailpit); prohibido en producción
EMAIL_DOMAIN_PROVIDER=             # proveedor de email para dominios verificados; vacío = «próximamente»; `memory` solo en pruebas
BIAN_ENABLED=false                 # asistente IA Bian; si es true, exige ANTHROPIC_API_KEY (validada al arrancar)
ANTHROPIC_API_KEY=                 # clave de la API de Anthropic; nunca en el frontend ni en logs
PLUGINS_DIR=                       # carpetas de plugins separadas por comas, las relativas desde la raíz del repo; vacío = plugins/ en la raíz (en Docker: /app/plugins,/data/plugins)
PLUGIN_INSTALL_DIR=                # dónde se instalan los plugins subidos desde la app (relativa: desde la raíz del repo); vacío = la última de PLUGINS_DIR (en Docker: /data/plugins)
PLUGIN_UPLOAD_ENABLED=true         # el propietario puede subir plugins firmados (.sfplugin) desde Licencia y plugins
SPIDERFOLIO_SUPERVISED=false       # algo vuelve a levantar la API y el worker al salir (Docker, npm run dev): habilita «Reiniciar ahora»
PLUGIN_PACKAGES=                   # paquetes npm de plugins, separados por comas
SEED_DEMO_PASSWORD=                     # solo local: contraseña de los usuarios demo (mínimo 10)

SEED_DEMO_PASSWORD la usa solo el seed, que además se niega a correr con NODE_ENV=production o si DATABASE_URL no apunta a localhost, 127.0.0.1 o ::1. El backend valida el entorno con Zod al arrancar y no inicia si falta algo o si JWT_ACCESS_SECRET tiene menos de 64 caracteres. Nunca commitear .env.
