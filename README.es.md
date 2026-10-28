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

Con Docker Compose. Elige dónde lo vas a instalar; cada opción tiene su paso a paso completo en la
[guía de instalación](docs/instalacion/README.md):

| Opción | Para qué | Guía |
| --- | --- | --- |
| Probar en tu PC | Verlo funcionando (Windows, macOS o Linux), con una bandeja de email de prueba | [Probar en tu PC](docs/instalacion/README.md#probar-en-tu-pc) |
| Servidor con dominio propio | Uso real, con HTTPS automático | [Servidor con dominio propio](docs/instalacion/README.md#servidor-con-dominio-propio) |
| Servidor con proxy propio | Ya tienes nginx, Traefik, IIS… | [Servidor con proxy propio](docs/instalacion/README.md#servidor-con-proxy-propio) |

Windows Server: lo recomendado es una máquina virtual Ubuntu en Hyper-V
([Windows](docs/instalacion/README.md#windows)).

Estos comandos descargan el paquete de instalación de la última Release. El script de instalación
pregunta lo mínimo, genera los secretos y escribe `.env`.

**Windows (PowerShell)**, con Docker Desktop en marcha:

```powershell
cd $HOME
$url = "https://github.com/spiderjad/SpiderFolio" +
  "/releases/latest/download/spiderfolio-deploy.zip"
Invoke-WebRequest $url -OutFile spiderfolio.zip
Expand-Archive spiderfolio.zip -DestinationPath .
cd spiderfolio
powershell -ExecutionPolicy Bypass -File .\setup.ps1
docker compose up -d
```

**Linux**:

```sh
url=https://github.com/spiderjad/SpiderFolio
url=$url/releases/latest/download/spiderfolio-deploy.tar.gz
curl -fsSL $url | tar -xz
cd spiderfolio
./setup.sh
docker compose up -d
```

Comprueba: `curl http://localhost:8080/api/health` responde `{"status":"ok"}`. Después abre la
dirección que elegiste (en tu PC, `http://localhost:8080`; los emails de prueba, en
`http://localhost:8025`).

Más: [email (SMTP)](docs/instalacion/email.md), [actualizar](docs/instalacion/actualizar.md), [copias de seguridad](docs/instalacion/copias-de-seguridad.md)
y la [guía en la web](https://spiderfolio.spiderjad.com/es/docs/instalar). In English:
[docs/install](docs/install/README.md).

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
