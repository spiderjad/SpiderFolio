<p align="center">
  <img src="brand/logo-light.svg" alt="SpiderFolio" width="320">
</p>

<p align="center"><a href="README.es.md">Leer en español</a></p>

<p align="center">
  <strong>Your company's internal documentation, organized and on your own server.</strong><br>
  Pages, files and controlled documents with permissions that make sense. Open source (AGPLv3).
</p>

<p align="center">
  <a href="docs/install/README.md">Install</a> ·
  <a href="https://spiderfolio.spiderjad.com/docs">Documentation</a> ·
  <a href="https://spiderfolio.spiderjad.com/plugins">Plugins</a> ·
  <a href="CONTRIBUTING.md">Contribute</a>
</p>

![SpiderFolio home](docs/capturas/inicio.png)

## What it is

SpiderFolio replaces the chaos of shared folders with a place where each person sees what is meant
for them. Designed for small and mid-sized businesses in Spanish-speaking markets, including the shop
floor.

- **Notion-style pages and a file library** with spaces, folders, versions and full-text search (also
  inside PDF and Word files).
- **Permissions by department and role** that explain themselves: every folder, file and page shows
  who has access and why.
- **Controlled documents**: document code, a single current version, approvals, read confirmation,
  controlled PDF and an exportable audit log.
- **For the shop floor**: QR codes that always open the current version, expiry dates and a simple view
  for tablets with username and PIN.
- **Bian, the AI assistant**: answers only from the current content each person is allowed to see, and
  cites the source. Uses your own Anthropic API key.
- **Security**: two-step verification, sessions and trusted devices, audit log and strict isolation
  between companies.
- **In Spanish and English**: each person picks their language; the company sets the default one.

|                                                |                                                                |
| ---------------------------------------------- | -------------------------------------------------------------- |
| ![File explorer](docs/capturas/explorador.png) | ![Controlled document](docs/capturas/documento-controlado.png) |
| ![Permissions](docs/capturas/permisos.png)     | ![Bian](docs/capturas/bian.png)                                |

## Install

With Docker, on your own server:

```sh
git clone https://github.com/spiderjad/SpiderFolio
cd SpiderFolio/deploy
cp .env.example .env          # fill in the URL, the database password, the secrets and SMTP
docker compose --profile https up -d
```

Full guide: [docs/install](docs/install/README.md) (requirements, HTTPS, controlled PDF, files on
disk or S3, [updating](docs/install/upgrading.md) and [backups](docs/install/backups.md)). In
Spanish: [docs/instalacion](docs/instalacion/README.md).

## Commercial plugins

The core is complete and free. Some business features are offered as plugins that are activated with
a license verified offline: advanced security policies (require 2FA, allowed domains, SSO), import from
OneDrive and SharePoint, an MCP connector for Claude, industry templates and audit rooms. Without a
license, SpiderFolio works just the same. See [docs/spec/plugins.md](docs/spec/plugins.md) and the
[Plugins](https://spiderfolio.spiderjad.com/plugins) page.

## Development

Requirements: Node 24 (`.nvmrc`), npm 11 and Docker.

```sh
cp .env.example .env          # fill in JWT_ACCESS_SECRET, S3_ACCESS_KEY, S3_SECRET_KEY and SEED_DEMO_PASSWORD
docker compose up -d          # postgres, mailpit, rustfs, gotenberg
npm install
npm run db:migrate
npm run db:seed               # demo company "Embutidos Demo S.L." (@demo.local users)
npm run dev                   # API :4000 + worker + app :5173 + web :4321
```

| Command                    | What it does                                                          |
| -------------------------- | --------------------------------------------------------------------- |
| `npm run typecheck`        | TypeScript at the root and in every workspace                         |
| `npm run lint`             | ESLint, no warnings allowed                                           |
| `npm run test`             | Unit tests                                                            |
| `npm run test:integration` | Tests against real Postgres and Mailpit (`docker compose up -d`)      |
| `npm run check:secrets`    | No secrets in versioned files (also run in the hook and in CI)        |

Structure, rules and specification (in Spanish): [CLAUDE.md](CLAUDE.md) and [docs/spec/](docs/spec/).
To contribute: [CONTRIBUTING.md](CONTRIBUTING.md) (requires accepting the [CLA](CLA.md)).

## License

Copyright (C) 2026 Diego Pennisi. SpiderFolio is distributed under the [GNU Affero General Public License v3.0](LICENSE). If you offer a
modified version to other people over a network, you must also offer them its source code. Dependency
licenses: [docs/licencias-dependencias.md](docs/licencias-dependencias.md).

Vulnerabilities: [SECURITY.md](SECURITY.md). Conduct: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
