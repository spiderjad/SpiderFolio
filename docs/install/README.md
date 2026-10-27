Versión en español: [docs/instalacion/README.md](../instalacion/README.md)

# Install SpiderFolio

SpiderFolio runs on your own server with Docker: a PostgreSQL database, the API (which also serves the
app) and a worker. Migrations are applied automatically on startup.

## Requirements

- Linux with Docker Engine 24+ and Docker Compose v2 (`docker compose version`).
- 2 vCPU and 4 GB of RAM for a company of up to ~200 people; disk space depending on your files.
- An SMTP server for emails (verification, invitations, notifications): your company's own or a
  transactional one (Resend, Postmark, Amazon SES…).
- To access it from other machines: a domain pointing to the server (automatic HTTPS with the `https`
  profile) or your own proxy with TLS. Sessions use secure cookies: without HTTPS it only works on
  `localhost`.

## 1. Download

```sh
git clone https://github.com/spiderjad/SpiderFolio
cd SpiderFolio/deploy
cp .env.example .env
```

## 2. Configure `.env`

Fill in at least:

| Variable                                                        | What to set                                                                   |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `APP_URL`, `WEB_URL`                                            | The URL people use to sign in (with the https profile: `https://your-domain`) |
| `POSTGRES_PASSWORD`                                             | A long password                                                               |
| `JWT_ACCESS_SECRET`                                             | `openssl rand -base64 48`                                                     |
| `EMAIL_ENCRYPTION_KEY`, `MFA_ENCRYPTION_KEY`                    | `openssl rand -base64 32`, a different one for each                           |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | Your email server's details                                                   |

Keep a copy of `.env` somewhere safe: without `MFA_ENCRYPTION_KEY` nobody can sign in again with their
two-step verification.

## 3. Start

```sh
docker compose up -d
docker compose logs -f app   # "API lista" once migrations are done
```

With automatic HTTPS (Let's Encrypt), with `DOMAIN` set in `.env` and ports 80 and 443 open:

```sh
docker compose --profile https up -d
```

With the controlled document PDF (Gotenberg), also set `GOTENBERG_URL=http://gotenberg:3000`:

```sh
docker compose --profile https --profile pdf up -d
```

Without Gotenberg everything works the same, except the controlled PDF: the app shows that it is not
available.

## 4. Create the company

Open `APP_URL/register`: whoever registers creates the company and becomes its owner. Then invite
everyone else from Admin › Members.

For the installation's back office (`/internal`, the list of companies and their usage), flag the person
who manages the server and ask them to turn on two-step verification:

```sh
docker compose exec db psql -U spiderfolio -c "UPDATE \"User\" SET \"isStaff\" = true WHERE email = 'you@email.com';"
```

## Optional

- **Files in S3** (R2, MinIO, AWS…): `STORAGE_DRIVER=s3` and the `S3_*` variables. The bucket needs
  CORS for `APP_URL` (GET, PUT, HEAD and exposing `ETag`). By default files go to the `files` volume.
- **Bian, the AI assistant**: `BIAN_ENABLED=true` and `ANTHROPIC_API_KEY` (queries are billed to your
  Anthropic account). Each company sets its monthly total and per-person limits in Admin › Bian.
- **Limits**: there are none by default. Each company can set storage, file size, saved versions and
  audit log retention in Admin › Limits and usage.
- **Commercial plugins**: [plugins.md](plugins.md).

## More

- [Upgrading](upgrading.md)
- [Backups and restore](backups.md)
- Full list of environment variables: `deploy/.env.example` and `docs/spec/entorno.md` (in Spanish).
