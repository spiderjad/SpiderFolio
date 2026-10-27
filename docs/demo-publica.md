# Demo pública en un VPS

Cómo montar una demo de SpiderFolio abierta al público (por ejemplo, `https://demo.<dominio>`) a partir
de la instalación propia con Docker ([docs/instalacion](instalacion/README.md),
[docs/spec/despliegue.md](spec/despliegue.md)). La demo es una instalación más, con tres diferencias:
los emails no salen a Internet, los datos se reinician solos cada pocas horas y nada de ella toca una
instalación real.

Reglas que no cambian por ser una demo:

- **La demo nunca comparte base, volúmenes, `.env` ni secretos con producción.** Base de datos propia,
  proyecto de Docker Compose propio y, de preferencia, un VPS propio.
- **No se desactiva ninguna medida de seguridad**: HTTPS, CSP, CORS y los rate limits quedan como en
  cualquier instalación. `NODE_ENV` sigue siendo `production` (lo fija `deploy/compose.yaml`).
- Nada de datos reales: solo contenido inventado.

## 1. VPS

| Recurso | Recomendado                                                               |
| ------- | ------------------------------------------------------------------------- |
| CPU/RAM | 2 vCPU y 4 GB (lo mismo que una empresa pequeña); +1 GB si activas Gotenberg |
| Disco   | 40 GB SSD: sistema, imágenes de Docker, la base y los archivos que suban los visitantes |
| Sistema | Linux con Docker Engine 24+ y Docker Compose v2                           |
| Red     | IPv4 pública (IPv6 opcional); puertos 22, 80 y 443                        |

Prepara el servidor como dice [despliegue.md § 15.6](spec/despliegue.md): usuario propio con sudo, SSH
solo con clave, firewall con 22, 80 y 443, parches automáticos y `.env` con permisos 600.

Un VPS dedicado evita sorpresas: el `compose.yaml` publica Caddy en 80 y 443, así que dos instalaciones
con el perfil `https` no pueden convivir en el mismo servidor sin un proxy común (no cubierto acá).

## 2. DNS

Crea un registro `A` (y `AAAA` si hay IPv6) para `demo.<dominio>` apuntando a la IP del VPS. Comprueba
que resuelve antes de arrancar Caddy, para que Let's Encrypt pueda emitir el certificado:

```sh
dig +short demo.<dominio>
```

## 3. Descargar y configurar

```sh
sudo mkdir -p /opt/spiderfolio-demo && sudo chown "$USER" /opt/spiderfolio-demo
git clone https://github.com/spiderjad/SpiderFolio /opt/spiderfolio-demo
cd /opt/spiderfolio-demo/deploy
cp .env.example .env
chmod 600 .env
```

### Mailpit en lugar de un SMTP real

La API exige un SMTP (`SMTP_HOST` es obligatoria) y hoy no se pueden desactivar los emails
(**Pendiente**). En la demo, los emails van a un Mailpit interno: nadie recibe correo real, y las
invitaciones o restablecimientos que pidan los visitantes no salen del servidor.

Crea `deploy/compose.demo.yaml` (archivo solo de la demo, no se sube al repositorio):

```yaml
services:
  mailpit:
    image: axllent/mailpit:v1.31.5
    ports:
      - "127.0.0.1:8025:8025" # interfaz web, solo por túnel SSH
    restart: unless-stopped
```

El puerto SMTP (1025) queda solo en la red interna de Compose. Para ver los emails desde tu equipo:
`ssh -L 8025:127.0.0.1:8025 usuario@demo.<dominio>` y abrir http://localhost:8025. **Nunca publiques
la interfaz de Mailpit**: ahí están los enlaces de invitación y de restablecimiento.

### `.env` de la demo

Las variables de la aplicación son las de `deploy/.env.example`; estas son las que cambian para la
demo:

| Variable                                     | Valor en la demo                                                       |
| -------------------------------------------- | ---------------------------------------------------------------------- |
| `APP_URL`                                    | `https://demo.<dominio>`                                               |
| `WEB_URL`                                    | La web pública del proyecto (`https://<dominio>`) o la misma `APP_URL` |
| `DOMAIN`                                     | `demo.<dominio>`                                                       |
| `HTTP_BIND`, `HTTP_PORT`                     | `127.0.0.1` y `8080` (solo Caddy entra a la app)                       |
| `TRUST_PROXY_HOPS`                           | `1` (detrás de Caddy). Imprescindible para que los rate limits usen la IP real de cada visitante |
| `POSTGRES_PASSWORD`                          | Una contraseña larga, **propia de la demo**                            |
| `JWT_ACCESS_SECRET`                          | `openssl rand -base64 48`, **nunca** el de producción                  |
| `EMAIL_ENCRYPTION_KEY`, `MFA_ENCRYPTION_KEY` | `openssl rand -base64 32`, una distinta para cada una                  |
| `SMTP_HOST`, `SMTP_PORT`                     | `mailpit` y `1025`                                                     |
| `SMTP_USER`, `SMTP_PASS`                     | Vacías                                                                 |
| `MAIL_FROM`                                  | `"SpiderFolio Demo <no-reply@demo.<dominio>>"`                         |
| `STORAGE_DRIVER`                             | `local` (los archivos en el volumen `files`, que se reinicia con la base) |
| `GOTENBERG_URL`                              | `http://gotenberg:3000` si quieres mostrar el PDF controlado; vacía si no |
| `BIAN_ENABLED`                               | `false`: las consultas se cobrarían en tu cuenta de Anthropic          |
| `PLUGIN_PACKAGES`                            | Vacía (la demo muestra el núcleo)                                      |
| `SENTRY_DSN`                                 | Opcional, un proyecto de Sentry aparte del de producción               |

`EMAIL_ALLOW_PRIVATE_HOSTS` queda vacía o en `false` (con `NODE_ENV=production` la API no arranca si es
`true`). No hace falta: solo afecta al SMTP propio de cada empresa, no al SMTP global que apunta a
Mailpit.

Agrega además estas variables **de Docker Compose** (no de la aplicación) al final de `.env`, para que
`docker compose`, `backup.sh` y `restore.sh` usen siempre el proyecto, los archivos y los perfiles de la
demo:

```sh
COMPOSE_PROJECT_NAME=spiderfolio-demo
COMPOSE_FILE=compose.yaml:compose.demo.yaml
COMPOSE_PROFILES=https,pdf      # o solo https sin Gotenberg
```

`SEED_DEMO_PASSWORD` no aplica: el seed no corre en la demo (ver § 5).

## 4. TLS y arranque

Caddy (perfil `https`, ya activo por `COMPOSE_PROFILES`) emite y renueva solo el certificado de
Let's Encrypt para `DOMAIN` y añade HSTS ([deploy/Caddyfile](../deploy/Caddyfile)).

```sh
cd /opt/spiderfolio-demo/deploy
docker compose up -d
docker compose logs -f app      # espera «API lista»
curl -fsS https://demo.<dominio>/api/health
```

Opcional, solo en el `Caddyfile` de esta copia: que los buscadores no indexen la demo, con
`X-Robots-Tag "noindex, nofollow"` dentro del bloque `header`.

No marques a nadie como staff (`isStaff`): el backoffice `/internal` no forma parte de la demo.

## 5. Empresas y usuarios demo

### Qué hay hoy

`npm run db:seed` crea «Embutidos Demo S.L.» (idioma `es`, zona `Europe/Madrid`) con cinco usuarios
`@demo.local` (dueña, admin, miembro, lector e invitado) y una sola contraseña (`SEED_DEMO_PASSWORD`).
Pero **no sirve para la demo pública**:

- se niega a correr con `NODE_ENV=production` o si `DATABASE_URL` no apunta a `localhost` (en Docker la
  base es `db`), y la imagen no está pensada para correr `npm` dentro;
- solo crea usuarios y la empresa: ni espacios, ni páginas, ni archivos, ni documentos controlados;
- no hay empresa ni usuarios en inglés.

**Pendiente**: un seed de demo pública (empresa en español y otra en inglés, con contenido) que se pueda
correr dentro del contenedor de forma explícita y segura.

### Cómo armarla mientras tanto (a mano, una sola vez)

Se arma el contenido desde la propia app y se guarda como **instantánea base**; cada reinicio vuelve a
ella (§ 6).

1. **Empresa en español**: en `https://demo.<dominio>/register`, con la app en español, crea
   «Embutidos Demo S.L.» con `duena@demo.local`. El email de verificación llega a Mailpit (túnel SSH):
   verifica la cuenta (sin email verificado no se puede invitar ni publicar).
2. Desde Administración › Miembros invita a `admin@demo.local`, `miembro@demo.local`,
   `lector@demo.local` (plaza de lector) e `invitado@demo.local` (invitado externo). Acepta cada
   invitación desde Mailpit y pon a todos la misma contraseña de demo (mínimo 10 caracteres, que no uses
   en ningún otro sitio: será pública).
3. Carga contenido inventado: departamentos, espacios, carpetas, algunas páginas, archivos de ejemplo,
   un documento controlado con su aprobación y confirmación de lectura, un QR y un vencimiento. Si
   quieres mostrar la vista de planta, crea también un lector de planta con PIN.
4. **Empresa en inglés**: repite los pasos con otra empresa (por ejemplo «Demo Foods Ltd.»,
   `owner@demo-en.local`, `admin@demo-en.local`, `member@demo-en.local`, `reader@demo-en.local`,
   `guest@demo-en.local`), con el idioma de la empresa en inglés (Seguridad › General) y cada usuario
   en inglés (Mi perfil).
5. En cada empresa, fija límites bajos en Administración › Límites y uso (almacenamiento total y
   tamaño máximo de archivo) para acotar lo que suban los visitantes.

Credenciales para publicar en la web: preferiblemente las de miembro y lector de cada idioma. Las de
dueño y admin permiten cambiar límites, roles y el SMTP propio de la empresa; publícalas solo si
aceptas que un visitante lo haga hasta el siguiente reinicio.

Limitaciones mientras no exista un «modo demo» (**Pendiente**): un visitante puede cambiar la
contraseña de una cuenta compartida, activar la verificación en dos pasos en ella o bloquearla con
intentos fallidos, y así dejar fuera a los demás hasta el próximo reinicio. Tampoco hay un aviso dentro
de la app de que los datos se borran periódicamente (**Pendiente**): ponlo en la página desde la que
enlazas la demo.

### Guardar la instantánea base

Con todo cargado, desde `deploy/`:

```sh
cd /opt/spiderfolio-demo/deploy
./backup.sh /opt/spiderfolio-demo/golden
mv /opt/spiderfolio-demo/golden/2* /opt/spiderfolio-demo/golden/base   # la carpeta con fecha recién creada
```

`golden/base/` queda con `db.dump`, `files.tar.gz` y `env`. Guárdala también fuera del servidor: es
lo único que cuesta rehacer.

## 6. Reinicio periódico

El reinicio restaura la instantánea base con `deploy/restore.sh` (borra y recrea **la base de la
demo**, reemplaza el volumen `files` y vuelve a arrancar). Al arrancar, la API aplica las migraciones
pendientes, así que una instantánea de una versión anterior se pone al día sola.

`/opt/spiderfolio-demo/reset-demo.sh` (esquema; revísalo antes de usarlo):

```sh
#!/bin/sh
# Reinicia la DEMO a la instantánea base. Nunca apuntarlo a una instalación real.
set -eu
cd /opt/spiderfolio-demo/deploy

# Salvaguardas: solo corre en el proyecto de la demo y con un dominio demo.*
grep -qx 'COMPOSE_PROJECT_NAME=spiderfolio-demo' .env || { echo "No es la demo: cancelado" >&2; exit 1; }
grep -qE '^DOMAIN=demo\.' .env || { echo "DOMAIN no es demo.*: cancelado" >&2; exit 1; }
[ -f /opt/spiderfolio-demo/golden/base/db.dump ] || { echo "Falta la instantánea base" >&2; exit 1; }

echo "$(date -u +%FT%TZ) reinicio de la demo"
# restore.sh pide confirmación escrita: se la damos solo aquí, con las salvaguardas de arriba.
printf 'RESTAURAR\n' | ./restore.sh /opt/spiderfolio-demo/golden/base
# Vacía también los emails capturados.
docker compose restart mailpit
curl -fsS https://demo.<dominio>/api/health > /dev/null && echo "demo lista"
```

```sh
chmod 700 /opt/spiderfolio-demo/reset-demo.sh
crontab -e
```

```cron
# Cada 3 horas (la demo queda fuera de servicio unos segundos en cada reinicio)
0 */3 * * * /opt/spiderfolio-demo/reset-demo.sh >> /var/log/spiderfolio-demo-reset.log 2>&1
```

Elige la frecuencia según el uso: más seguido si los visitantes suelen dejar cuentas bloqueadas.

## 7. Registro de empresas nuevas

Hoy no se puede desactivar `/register` (**Pendiente**: una variable o ajuste de instalación para
cerrar el alta pública). En la demo, cualquier visitante puede crear su propia empresa:

- el alta tiene rate limit (10 por hora por IP) y el email de verificación nunca le llega (va a
  Mailpit), así que esa empresa no puede invitar ni publicar;
- las empresas nuevas no tienen límites por defecto (**Pendiente**: límites por defecto para empresas
  nuevas de la instalación); vigila el disco (§ 9);
- desaparecen en el siguiente reinicio.

## 8. Copias de seguridad

No hacen falta: no programes `backup.sh` en la demo. Lo único que hay que conservar es la instantánea
base (`golden/base/`) y el `.env`, fuera del servidor.

## 9. Monitoreo y logs

- Monitor externo de disponibilidad sobre `https://demo.<dominio>/api/health` (verifica la base).
- Alerta de disco al 80 % (`df -h`, `docker system df`): los visitantes suben archivos.
- Logs: `docker compose logs -f app worker` (con rotación: 5 × 10 MB por servicio, en `compose.yaml`) y
  `/var/log/spiderfolio-demo-reset.log` para los reinicios.
- En el registro de auditoría de las empresas demo, picos de `auth.login.failure` y
  `auth.refresh.reuse_detected`.
- Errores de la aplicación: `SENTRY_DSN` de un proyecto propio de la demo (opcional).

## 10. Actualizar

```sh
cd /opt/spiderfolio-demo
git pull                         # compose.yaml, scripts y .env.example nuevos
cd deploy
docker compose pull
docker compose up -d
docker compose logs -f app       # migraciones automáticas; espera «API lista»
```

Compara `.env.example` con `.env` por si la versión trae variables nuevas
([docs/instalacion/actualizar.md](instalacion/actualizar.md)). Después de una versión con cambios
visibles, actualiza el contenido demo y vuelve a guardar la instantánea base (§ 5); si no, el siguiente
reinicio restaura la anterior y la migra al arrancar.

Si todavía no hay imagen publicada en el registro, compílala desde la raíz del repositorio y úsala con
`SPIDERFOLIO_IMAGE` en `.env`:

```sh
cd /opt/spiderfolio-demo
docker build -t spiderfolio:demo --build-arg VITE_WEB_URL=https://<dominio> .
# en deploy/.env: SPIDERFOLIO_IMAGE=spiderfolio:demo
cd deploy && docker compose up -d
```

## Resumen de pendientes

- Seed de demo pública (empresa en español y en inglés, con contenido) que corra de forma segura dentro
  del contenedor; hoy el seed solo funciona contra una base local.
- Desactivar los emails sin SMTP (hoy se usa Mailpit interno).
- Desactivar el registro público (`/register`).
- «Modo demo»: impedir cambiar contraseña, activar 2FA, configurar el SMTP propio y cambiar límites en
  las cuentas compartidas, y avisar en la app de que los datos se reinician.
- Límites por defecto para las empresas nuevas de una instalación.
