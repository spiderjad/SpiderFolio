# syntax=docker/dockerfile:1.7
# Imagen única de SpiderFolio: API, worker y la app ya compilada (la sirve la propia API). Uso y
# variables: docs/instalacion/README.md. Los plugins en plugins/ se incluyen al compilar la imagen.
ARG NODE_IMAGE=node:24.22.0-alpine

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
# Primero solo los package.json: la capa de dependencias se reutiliza mientras no cambien.
COPY package.json package-lock.json .npmrc ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
COPY web/package.json web/
COPY packages/ packages/
COPY plugins/ plugins/
# The root "prepare" script runs on npm ci; without .git it does nothing, but it has to exist.
COPY scripts/install-hooks.ts scripts/
# npm ci respeta allowScripts del package.json: solo lo aprobado ejecuta scripts de instalación.
RUN npm ci --no-audit --no-fund

FROM deps AS build
COPY . .
# Cliente de Prisma y el motor de migraciones de linux-musl (el postinstall está denegado).
RUN npm run db:generate -w @spiderfolio/backend && npx --workspace @spiderfolio/backend prisma version
# La app, con la parte de app de los plugins que haya en plugins/.
# Web pública a la que enlaza la app (documentación y legales).
ARG VITE_WEB_URL="https://spiderfolio.spiderjad.com"
ENV VITE_WEB_URL=${VITE_WEB_URL}
RUN npm run build -w @spiderfolio/frontend

FROM ${NODE_IMAGE} AS runtime
# The version this image is (the release workflow sets it; «dev» in a local build).
ARG SPIDERFOLIO_VERSION=dev
ENV SPIDERFOLIO_VERSION=${SPIDERFOLIO_VERSION} \
    NODE_ENV=production \
    PORT=4000 \
    APP_STATIC_DIR=/app/frontend/dist \
    PLUGINS_DIR=/app/plugins,/data/plugins \
    PLUGIN_INSTALL_DIR=/data/plugins \
    STORAGE_DRIVER=local \
    STORAGE_DIR=/data/files
WORKDIR /app
COPY --from=build --chown=node:node /app /app
# /data/plugins: the plugins volume (built plugins installed without rebuilding the image).
RUN mkdir -p /data/files /data/plugins && chown node:node /data/files /data/plugins
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4000/api/health > /dev/null || exit 1
# Aplica las migraciones pendientes (núcleo y plugins) y arranca la API. El worker usa la misma imagen
# con: node backend/src/worker.ts
CMD ["node", "backend/scripts/start.ts"]
