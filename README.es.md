<p align="center">
  <img src="brand/logo-light.svg" alt="SpiderFolio" width="320">
</p>

<p align="center"><a href="README.md">English version: README.md</a></p>

<p align="center">
  <strong>La documentación interna de tu empresa, ordenada y en tu propio servidor.</strong><br>
  Páginas, archivos y documentos controlados con permisos que se entienden. Open source (AGPLv3).
</p>

<p align="center">
  <a href="docs/instalacion/README.md">Instalar</a> ·
  <a href="https://spiderfolio.spiderjad.com/docs">Documentación</a> ·
  <a href="https://spiderfolio.spiderjad.com/plugins">Plugins</a> ·
  <a href="CONTRIBUTING.md">Contribuir</a>
</p>

![Inicio de SpiderFolio](docs/capturas/inicio.png)

## Qué es

SpiderFolio reemplaza el caos de carpetas compartidas por un lugar donde cada persona ve lo que le
corresponde. Pensado para pymes de habla hispana, también en planta.

- **Páginas tipo Notion y biblioteca de archivos** con espacios, carpetas, versiones y búsqueda de
  texto completo (también dentro de PDF y Word).
- **Permisos por departamentos y roles** que se explican: cada carpeta, archivo y página muestra quién
  accede y por qué.
- **Documentos controlados**: código, una única versión vigente, aprobaciones, confirmación de lectura,
  PDF controlado y auditoría exportable.
- **Para la planta**: códigos QR que abren siempre la versión vigente, vencimientos y una vista simple
  para tablets con usuario y PIN.
- **Bian, el asistente IA**: responde solo con el contenido vigente que cada persona puede ver y cita la
  fuente. Usa tu propia clave de la API de Anthropic.
- **Seguridad**: verificación en dos pasos, sesiones y dispositivos de confianza, registro de auditoría
  y aislamiento estricto entre empresas.
- **En español y en inglés**: cada persona elige su idioma; la empresa fija el idioma por defecto.

|                                             |                                                                 |
| ------------------------------------------- | --------------------------------------------------------------- |
| ![Explorador](docs/capturas/explorador.png) | ![Documento controlado](docs/capturas/documento-controlado.png) |
| ![Permisos](docs/capturas/permisos.png)     | ![Bian](docs/capturas/bian.png)                                 |

## Instalar

Con Docker, en un servidor propio:

```sh
git clone https://github.com/spiderjad/SpiderFolio
cd SpiderFolio/deploy
cp .env.example .env          # completa la URL, la contraseña de la base, los secretos y el SMTP
docker compose --profile https up -d
```

Guía completa: [docs/instalacion](docs/instalacion/README.md) (requisitos, HTTPS, PDF controlado,
archivos en disco o S3, [actualizar](docs/instalacion/actualizar.md) y
[copias de seguridad](docs/instalacion/copias-de-seguridad.md)).

## Plugins comerciales

El núcleo es completo y gratuito. Algunas funciones para empresas se ofrecen como plugins que se
activan con una licencia verificada sin conexión: políticas de seguridad avanzadas (exigir 2FA,
dominios permitidos, SSO), importación desde OneDrive y SharePoint, conector MCP para Claude, plantillas
por rubro y salas de auditoría. Sin licencia, SpiderFolio funciona igual. Ver
[docs/spec/plugins.md](docs/spec/plugins.md) y la página [Plugins](https://spiderfolio.spiderjad.com/plugins).

## Desarrollo

Requisitos: Node 24 (`.nvmrc`), npm 11 y Docker.

```sh
cp .env.example .env          # completa JWT_ACCESS_SECRET, S3_ACCESS_KEY, S3_SECRET_KEY y SEED_DEMO_PASSWORD
docker compose up -d          # postgres, mailpit, rustfs, gotenberg
npm install
npm run db:migrate
npm run db:seed               # empresa demo «Embutidos Demo S.L.» (usuarios @demo.local)
npm run dev                   # API :4000 + worker + app :5173 + web :4321
```

| Comando                    | Qué hace                                                                   |
| -------------------------- | -------------------------------------------------------------------------- |
| `npm run typecheck`        | TypeScript en la raíz y en cada workspace                                  |
| `npm run lint`             | ESLint, sin advertencias                                                   |
| `npm run test`             | Tests unitarios                                                            |
| `npm run test:integration` | Tests con Postgres y Mailpit reales (`docker compose up -d`)               |
| `npm run check:secrets`    | Ningún secreto en los archivos versionados (también en el hook y en el CI) |

Estructura, reglas y especificación: [CLAUDE.md](CLAUDE.md) y [docs/spec/](docs/spec/). Para
contribuir: [CONTRIBUTING.md](CONTRIBUTING.md) (requiere aceptar el [CLA](CLA.es.md)).

## Licencia

Copyright (C) 2026 Diego Pennisi. SpiderFolio se distribuye bajo la [GNU Affero General Public License v3.0](LICENSE). Si ofreces una
versión modificada a otras personas a través de una red, tienes que ofrecerles también su código fuente.
Licencias de las dependencias: [docs/licencias-dependencias.md](docs/licencias-dependencias.md).

Vulnerabilidades: [SECURITY.md](SECURITY.md). Conducta: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
