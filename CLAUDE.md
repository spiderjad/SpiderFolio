# CLAUDE.md — SpiderFolio

## Pruebas (regla obligatoria)
- Durante el desarrollo no escribas ni corras tests.
- Antes de cada commit, solo `npm run typecheck` y `npm run lint`. Nada más.
- Los tests de seguridad (permisos, aislamiento entre empresas) se hacen todos juntos al cerrar el módulo, cuando quien mantiene el proyecto lo pida.
- Nunca corras la suite completa, la integración completa, `test:docker` ni E2E salvo que quien mantiene el proyecto lo pida.
- No abrir el navegador para probar a mano: eso lo hace quien mantiene el proyecto. Las capturas sí: cada vez que cambia una pantalla con guía, regenerarlas con `web/scripts/capturas.ts` (base `spiderfolio_capturas`, ver «Trabajo»).
- Si typecheck o lint fallan, máximo 2 intentos de arreglo. Si sigue fallando, commit de lo que funciona, anotá el fallo en `docs/plans/` y avisá a quien mantiene el proyecto en una línea.

## Producto
Software open source (AGPLv3), multi-tenant e instalable en servidor propio, para que pymes de habla hispana gestionen su documentación interna: páginas tipo Notion y biblioteca de archivos con carpetas. Funciones comerciales como plugins con licencia (docs/spec/plugins.md).
Permisos entendibles por departamentos y roles (cada recurso explica quién accede y por qué).
Documentos controlados: versión vigente única, aprobaciones, confirmación de lectura, auditoría.
Pensado para planta: QR, vencimientos, vista simple de operario. Conector MCP para Claude (plugin).
Interfaz en español neutro. Web pública del proyecto (tudominio.com) y la app de cada instalación (API en /api; en Docker la API sirve también la app, ver docs/spec/despliegue.md).

## Stack (no agregar dependencias sin preguntar)
Monorepo npm workspaces, Node 24, TypeScript estricto (sin `any` ni `@ts-ignore`).
- backend/: Express 5, Prisma 7 + PostgreSQL 16, Zod, pg-boss, S3 (RustFS local / R2 prod) o disco local.
- frontend/: React 18 + Vite, Tailwind 4, componentes propios sobre Radix en `components/ui`, React Router 7, TanStack Query/Table, Tiptap.
- web/: Astro (web pública).
- packages/: tailwind-preset, limits, content, plugin-sdk.
- plugins/: plugins comerciales (privados; no se publican con el núcleo).
- Local: docker-compose (postgres, mailpit, rustfs, gotenberg).

## Comandos
```bash
docker compose up -d
npm install
npm run db:migrate     # prisma migrate dev --name <descripcion>
npm run db:seed        # solo base local
npm run dev            # api :4000 + worker + app :5173
npm run typecheck
npm run lint
npm run test           # sin servicios externos
npm run test:integration
```

## Estructura
```
backend/src/   app.ts, server.ts, config/, lib/ (prisma, tenantPrisma, jwt, crypto, s3…),
               middleware/ (auth, tenant, requireCapability, rateLimit, errorHandler),
               modules/<área>/ (routes → service → db), tests/
frontend/src/  main.tsx, router.tsx, lib/, auth/, components/ui/, components/,
               features/<área>/, i18n/, styles/
web/src/       layouts/, components/, content/docs/, pages/
packages/      tailwind-preset, limits, content, plugin-sdk
plugins/       plugins comerciales (security-policies, onedrive-import, mcp-connector, templates, audit-rooms) y tools/
docs/spec/     especificación detallada
```
### Carpetas (Windows y Mac)
Nada depende de rutas absolutas ni de Windows: dentro del repo, rutas relativas; fuera, `SPIDERFOLIO_HOME`
(carpeta raíz de todo SpiderFolio, este repo incluido). Por defecto `C:\dev\SpiderFolio` en Windows
y `~/dev/SpiderFolio` en Mac; el núcleo está dentro, en `$SPIDERFOLIO_HOME/public`.
```
$SPIDERFOLIO_HOME/public                 núcleo (este repo)
$SPIDERFOLIO_HOME/plugins                plugins comerciales (repo privado; ve el núcleo como .core, `npm run core:link`)
$SPIDERFOLIO_HOME/claves                 claves de firma (prod, prod-paquetes…): solo leer los .pub, nunca los .key
$SPIDERFOLIO_HOME/backups                volcados de la base de desarrollo
$SPIDERFOLIO_HOME/dev-plugins            plugins compilados para el entorno de desarrollo (PLUGINS_DIR)
$SPIDERFOLIO_HOME/instalacion-prueba     instalación de prueba (como la haría un cliente)
$SPIDERFOLIO_HOME/archivo                archivo viejo (repo aparte, solo consulta)
```
Nunca escribir rutas absolutas ni de un sistema operativo en código, scripts o configs.
**Nunca crear carpetas fuera de `SPIDERFOLIO_HOME` (`C:\dev\SpiderFolio`) sin preguntar antes**: ni junto a
ella, ni en `C:\dev`, ni en el perfil del usuario. Dentro, tampoco carpetas nuevas en la raíz sin preguntar.
No tocar la instalación de prueba (`$SPIDERFOLIO_HOME/instalacion-prueba`).
Preparar un Mac: CONTRIBUTING.md, «Development on a Mac».

Backend: sin lógica de negocio en las rutas. Frontend: datos del servidor con TanStack Query; selectores que pueden crecer usan `components/ui/combobox.tsx`.

### Listas y tablas (regla de paginación)
- Todas paginan, ordenan y filtran en el servidor, con **cursor** (`cursor` → `nextCursor`, `pageSize` máx. 100 y por defecto 25, orden estable con `id` de desempate). Helper común en `backend/src/lib/pagination.ts` (`pageShape`, `offsetArgs`, `pageOf`); un cursor inválido es 400. Las listas que crecen sin parar (auditoría, notificaciones, actividad, archivos) usan además el cursor por último elemento visto (`cursorPageOf`).
- Frontend: scroll infinito con `useInfiniteList` (`useInfiniteQuery`, `components/ui/infinite.tsx`): carga automática al llegar al final (IntersectionObserver), botón «Cargar más» accesible como respaldo y contador fijo «Mostrando N de M». Sin botones Anterior/Siguiente ni números de página. Los filtros y el orden viven en la URL.
- Listas largas virtualizadas con `@tanstack/react-virtual` (desde 60 filas): `DataTable` (cabecera fija) e `InfiniteList`. Nunca traer la lista completa para filtrar o paginar en el navegador.

## Seguridad (esencial)
- Multi-tenancy: todo acceso a datos de un workspace pasa por `forTenant`; un recurso de otro tenant responde 404.
- Permisos y capacidades se validan siempre en el backend; el frontend solo oculta.
- Auth: JWT + refresh en cookie httpOnly, argon2; Zod en todo body, query y params; errores con formato único sin stack ni errores de Prisma.
- Sin secretos en el código ni en logs; nunca imprimir ni commitear credenciales.
- No desactivar medidas de seguridad (CSP, CORS, rate limit) para que algo funcione.
- Nunca borrar ni resetear la base de desarrollo (`migrate reset`, `down -v`, DROP, TRUNCATE) sin preguntar.
- Migraciones: nunca dejar que `prisma migrate dev` genere una sin nombre (siempre `--name <descripcion>`) y revisar su SQL antes de aplicarla. Si genera algo que no pediste (ej. un `ALTER` sobre una columna generada como `tsv`), no se aplica: se corrige el schema (`@default(dbgenerated())` en las columnas generadas) hasta que `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` salga vacío.
- Límites: sin planes; los valores los fija cada empresa (Workspace.limits). Nada de límites numéricos en el código fuera de `packages/limits`.
- Plugins: el núcleo nunca depende de `plugins/`; las funciones comerciales entran por los puntos de extensión (docs/spec/plugins.md).

## Trabajo
- Verificación y tests: ver «Pruebas» al principio (solo typecheck y lint).
- Tests solo para backend, seguridad, permisos, tenancy y lógica pura. En el frontend no se escriben tests de pantallas ni componentes.
- Preguntar solo si algo toca seguridad o borra datos.
- Commits en inglés con formato Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`, `refactor:`).
- Comentarios nuevos del código en inglés; los existentes en español se traducen solo al tocar cada archivo.
- Textos de interfaz en español, centralizados en `i18n/`.
- Cada cambio que toque una pantalla actualiza su guía en `web/src/content/docs/` en los dos idiomas (es y en). Si cambia lo que se ve, regenerar las capturas con `web/scripts/capturas.ts` (base propia `*_capturas`, nunca la de desarrollo).
- Clips de demo (`web/scripts/clips.ts`): se regeneran solo cuando cambia algo visible en esas pantallas (documento controlado, QR, Bian, compartir), nunca en cada commit. Los MP4 de la web van en `web/public/clips/`; los GIF del README no se versionan: se suben a la Release con `CLIPS_RELEASE=vX.Y.Z` y el README los enlaza desde ahí.
- Respuestas cortas.

## Índice de docs/spec (leer solo si la tarea lo necesita)
| Tema | Archivo |
|---|---|
| Variables de entorno | docs/spec/entorno.md |
| Dominio y modelo de datos | docs/spec/modelo-de-datos.md |
| Auth, sesiones, multi-tenancy | docs/spec/auth-y-tenancy.md |
| Acceso a contenido (resolveAccess) | docs/spec/acceso-a-contenido.md |
| Panel de administración | docs/spec/panel-admin.md |
| Límites de la empresa | docs/spec/limites.md |
| Adopción (plantillas, importación, versiones, QR…) | docs/spec/adopcion.md |
| Diseño y componentes | docs/spec/diseno.md |
| Archivos y subidas | docs/spec/archivos.md |
| Notificaciones, jobs, observabilidad | docs/spec/operacion.md |
| Despliegue | docs/spec/despliegue.md |
| Pruebas | docs/spec/pruebas.md |
| Plugins y licencias | docs/spec/plugins.md |
| Conector para Claude (MCP) | docs/spec/conector-mcp.md |
| Fase 2 | docs/spec/fase-2.md |
