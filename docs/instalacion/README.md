English version: [docs/install/README.md](../install/README.md)

# Instalar SpiderFolio

SpiderFolio corre en tu propio servidor con Docker: una base PostgreSQL, la API (que también sirve la
app) y un worker. Las migraciones se aplican solas al arrancar.

## Requisitos

- Linux con Docker Engine 24+ y Docker Compose v2 (`docker compose version`).
- 2 vCPU y 4 GB de RAM para una empresa de hasta ~200 personas; disco según tus archivos.
- Un servidor SMTP para los emails (verificación, invitaciones, avisos): el de tu empresa o uno
  transaccional (Resend, Postmark, Amazon SES…).
- Para entrar desde otros equipos: un dominio apuntando al servidor (HTTPS automático con el perfil
  `https`) o tu propio proxy con TLS. Las sesiones usan cookies seguras: sin HTTPS solo funciona en
  `localhost`.

## 1. Descargar

```sh
git clone https://github.com/spiderjad/SpiderFolio
cd SpiderFolio/deploy
cp .env.example .env
```

## 2. Configurar `.env`

Completa como mínimo:

| Variable                                                        | Qué poner                                                              |
| --------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `APP_URL`, `WEB_URL`                                            | La URL con la que se entra (con el perfil https: `https://tu-dominio`) |
| `POSTGRES_PASSWORD`                                             | Una contraseña larga                                                   |
| `JWT_ACCESS_SECRET`                                             | `openssl rand -base64 48`                                              |
| `EMAIL_ENCRYPTION_KEY`, `MFA_ENCRYPTION_KEY`                    | `openssl rand -base64 32`, una distinta para cada una                  |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | Los datos de tu servidor de email                                      |

Guarda una copia de `.env` en un lugar seguro: sin `MFA_ENCRYPTION_KEY` nadie puede volver a entrar con
su verificación en dos pasos.

## 3. Arrancar

```sh
docker compose up -d
docker compose logs -f app   # «API lista» cuando terminó de migrar
```

Con HTTPS automático (Let's Encrypt), con `DOMAIN` en `.env` y los puertos 80 y 443 abiertos:

```sh
docker compose --profile https up -d
```

Con el PDF de los documentos controlados (Gotenberg), además `GOTENBERG_URL=http://gotenberg:3000`:

```sh
docker compose --profile https --profile pdf up -d
```

Sin Gotenberg todo funciona igual, salvo el PDF controlado: la app avisa que no está disponible.

## 4. Crear la empresa

Abre `APP_URL/register`: quien se registra crea la empresa y queda como propietario. Después invita al
resto desde Administración › Miembros.

Para el backoffice de la instalación (`/internal`, lista de empresas y su uso), marca a quien administra
el servidor y pídele activar la verificación en dos pasos:

```sh
docker compose exec db psql -U spiderfolio -c "UPDATE \"User\" SET \"isStaff\" = true WHERE email = 'tu@email.com';"
```

## Opcional

- **Archivos en S3** (R2, MinIO, AWS…): `STORAGE_DRIVER=s3` y las variables `S3_*`. El bucket necesita
  CORS para `APP_URL` (GET, PUT, HEAD y exponer `ETag`). Por defecto los archivos van al volumen `files`.
- **Bian, el asistente IA**: `BIAN_ENABLED=true` y `ANTHROPIC_API_KEY` (las consultas se cobran en tu
  cuenta de Anthropic). Cada empresa fija su total mensual y los límites por persona en
  Administración › Bian.
- **Límites**: por defecto no hay ninguno. Cada empresa puede fijar almacenamiento, tamaño de archivo,
  versiones guardadas y retención de la auditoría en Administración › Límites y uso.
- **Plugins comerciales**: [plugins.md](plugins.md).

## Más

- [Actualizar](actualizar.md)
- [Copias de seguridad y restauración](copias-de-seguridad.md)
- Variables de entorno completas: `deploy/.env.example` y `docs/spec/entorno.md`.
