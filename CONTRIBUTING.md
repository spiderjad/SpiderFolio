# Contributing to SpiderFolio

Thanks for wanting to help! SpiderFolio is an internal documentation manager for small and mid-sized
businesses in Spanish-speaking markets: pages, files and controlled documents with permissions that
make sense.

## Before you start

- Read and accept the [Code of conduct](CODE_OF_CONDUCT.md).
- Every contribution requires accepting the [CLA](CLA.md) (you sign it in your first pull request).
- For large changes, open an issue first so we can discuss the approach.
- Vulnerabilities: do **not** open a public issue; follow [SECURITY.md](SECURITY.md).

## Development environment

Requirements: Node 24 (see `.nvmrc`), npm 11 and Docker.

```sh
cp .env.example .env          # fill in S3_ACCESS_KEY, S3_SECRET_KEY and SEED_DEMO_PASSWORD
docker compose up -d          # postgres, mailpit, rustfs, gotenberg
npm install
npm run db:migrate
npm run db:seed               # demo company "Embutidos Demo S.L."
npm run dev                   # API :4000 + worker + app :5173 + web :4321
```

Emails land in Mailpit: http://localhost:8025.

## Project rules

They are in [CLAUDE.md](CLAUDE.md) and in [docs/spec/](docs/spec/) (in Spanish). The most important
ones:

- Strict TypeScript: no `any` and no `@ts-ignore`.
- Multi-tenancy: all access to a company's data goes through `forTenant`; a resource belonging to
  another company responds 404.
- Permissions are always checked in the backend; the frontend only hides things.
- Zod on every body, query and params; errors use the single shared format.
- Lists are paginated on the server with a cursor.
- UI texts are centralized in `i18n/`: neutral Spanish (informal «tú») as the reference language, plus
  English.
- Don't add dependencies without discussing it first.
- The core never depends on the plugins: anything that is an extension goes through the extension
  points in [docs/spec/plugins.md](docs/spec/plugins.md).

## Translations

The app, the API emails and the public website are available in Spanish (`es`, the reference catalog)
and English (`en`). Brazilian Portuguese (`pt-BR`) is planned.

- To fix or improve a translation, edit the matching catalog (`frontend/src/i18n/en/`,
  `backend/src/i18n/en.ts`, `web/src/i18n/en/` or `web/src/content/docs/en/`).
- To add a language, follow the steps in [docs/spec/i18n.md](docs/spec/i18n.md) («Sumar un idioma»):
  copy the English catalog, translate it and register the locale in the app, the API and the website.
  The typecheck fails if a key is missing or left over.
- Use the glossary and the tone guide in that same file so terms stay consistent.

## Before opening the pull request

```sh
npm run typecheck
npm run lint
npm run test                  # unit tests
npm run test:integration      # requires the docker compose services
```

- One pull request per topic, explaining what changes and why.
- If you touch permissions or isolation between companies, add tests.
- Commit messages in Spanish, in the present tense («agrega…», «corrige…»).
