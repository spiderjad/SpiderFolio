15. Despliegue (instalación propia con Docker)

SpiderFolio se instala en el servidor de cada empresa. La guía para quien instala está en
docs/instalacion/ (README, actualizar, copias de seguridad, plugins); acá, cómo está armado.

15.1 Arquitectura
Internet ─▶ Caddy (perfil «https», 80/443, HTTPS automático para DOMAIN)   [opcional]
              └── app:4000
            app (Node: API en /api + la app compilada, con su CSP) ─▶ db (Postgres, sin puerto público)
            worker (misma imagen: colas, tareas programadas, jobs de plugins)
            gotenberg (perfil «pdf», solo red interna)                        [opcional]
Archivos ─▶ volumen «files» (STORAGE_DRIVER=local) o un bucket S3 (STORAGE_DRIVER=s3)
Emails ─▶ el SMTP de la empresa o uno transaccional

15.2 Archivos
Dockerfile (raíz): una sola imagen node:24.22.0-alpine (la versión de .nvmrc). Etapa deps: npm ci con
.npmrc (strict-allow-scripts) y la lista allowScripts del package.json; etapa build: prisma generate,
prisma version (trae el schema-engine de linux-musl porque el postinstall de @prisma/engines está
denegado) y el build de la app con los plugins que haya en plugins/ (VITE_WEB_URL como argumento);
etapa final con usuario node, HEALTHCHECK a /api/health y CMD node backend/scripts/start.ts. El backend
corre en TypeScript directo (Node quita los tipos): no hay paso de tsc.
backend/scripts/start.ts: prisma migrate deploy con reintentos mientras la base arranca y después la
API. Las migraciones de los plugins las aplican la API y el worker al cargarlos (con lock).
deploy/compose.yaml: db, app (publicada en HTTP_BIND:HTTP_PORT), worker (espera a que la app esté
sana, o sea, migrada), caddy (perfil https) y gotenberg (perfil pdf); volúmenes db-data, files,
caddy-data y caddy-config; restart: unless-stopped; logs con rotación.
deploy/.env.example: todas las variables, con los secretos vacíos y cómo generarlos.
deploy/Caddyfile: HTTPS para {$DOMAIN}, HSTS y reverse_proxy a app:4000 (la CSP la pone la app).
deploy/backup.sh y deploy/restore.sh: pg_dump (formato custom) + tar del volumen files + copia de .env,
con rotación; la restauración pide confirmación escrita y detiene app y worker.

15.3 La API sirve la app
Con APP_STATIC_DIR (en la imagen, /app/frontend/dist) la API sirve la app: assets con hash con caché de
un año, el resto sin caché y cualquier ruta que no sea /api cae en index.html. Cabeceras: la CSP de
frontend/csp.ts (con el origen de S3 si los archivos no están en el mismo origen), nosniff,
Referrer-Policy y X-Frame-Options DENY.

15.4 Almacenamiento en disco local
STORAGE_DRIVER=local guarda los objetos en STORAGE_DIR/files (y lo de sistema en STORAGE_DIR/system),
con las mismas claves que en S3. Las «URLs prefirmadas» son /api/v1/storage/:token: un token HMAC
(clave derivada de JWT_ACCESS_SECRET) que fija operación, clave, vencimiento y, al subir, tamaño y tipo.
Las subidas por partes guardan cada parte en STORAGE_DIR/.uploads y se unen al completar (ETag = MD5,
como S3). Las descargas salen con nosniff, CSP sandbox (salvo PDF) y como adjunto si el tipo puede
ejecutar código (HTML, SVG, XML), porque se sirven desde el mismo origen que la app. Rango simple
(bytes=a-b) para las vistas previas.

15.5 Gotenberg opcional
Sin GOTENBERG_URL no se genera el PDF de las páginas controladas: el job se descarta, la descarga
responde UNAVAILABLE con el motivo y la app avisa en el historial del documento (/auth/me trae
instance.controlledPdf). El PDF de los archivos PDF controlados no lo necesita.

15.6 Preparar el servidor (recomendado)
Linux con Docker; usuario propio con sudo; SSH solo con clave; firewall con 22, 80 y 443; parches
automáticos; .env con permisos 600; copias diarias fuera del servidor y restauración probada antes de
cargar datos reales.

15.7 Monitoreo mínimo
GET /api/health (verifica la base), un monitor externo de disponibilidad, alerta de disco al 80 % y
revisar en el registro auth.refresh.reuse_detected y picos de auth.login.failure.
