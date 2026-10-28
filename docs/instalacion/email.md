English version: [docs/install/email.md](../install/email.md)

# Email (SMTP)

SpiderFolio manda emails para confirmar cuentas, recuperar contraseñas, invitar personas, avisar de documentos
y compartir enlaces. Hay dos niveles:

1. **El SMTP de la instalación** (obligatorio): lo configura quien administra el servidor y lo usan todas las
   empresas.
2. **El remitente propio de la empresa** (opcional): cada empresa puede mandar sus emails desde su propio
   servidor SMTP y con su propia dirección.

## El SMTP de la instalación

Va en el `.env` de la instalación (la carpeta `spiderfolio`). Sirve el de tu empresa o un servicio
transaccional (Resend, Postmark, Amazon SES…).

| Variable | Qué poner |
|---|---|
| `SMTP_HOST` | El servidor SMTP, por ejemplo `smtp.tu-proveedor.com`. |
| `SMTP_PORT` | `465` (TLS directo) o `587` (STARTTLS). Usa el que indique tu proveedor. |
| `SMTP_USER` | La casilla completa con la que entras al correo, por ejemplo `no-reply@tu-empresa.com`. |
| `SMTP_PASS` | Su contraseña, **entre comillas simples**: `SMTP_PASS='tu-contraseña'`. Una sola vez cada comilla, sin espacios antes ni después. |
| `MAIL_FROM` | El remitente: `"SpiderFolio <no-reply@tu-empresa.com>"`. La dirección **tiene que ser la misma casilla que `SMTP_USER`**: casi todos los servidores rechazan cualquier otra. |

`SMTP_HOST`, `SMTP_PORT` y `MAIL_FROM` son obligatorias: si falta alguna, la API no arranca y el log dice
cuál. Los emails de cuenta (confirmar el email, la contraseña, el inicio de sesión) **siempre** salen por este
servidor, aunque la empresa tenga remitente propio. Más variables en [Configuración](https://spiderfolio.spiderjad.com/es/docs/configuracion).

### Después de cambiar el `.env`

Desde la carpeta de la instalación, recrea la app y el worker para que lean los valores nuevos:

```sh
docker compose up -d --force-recreate app worker
```

Un `docker compose restart` no alcanza: reinicia los contenedores con el `.env` que tenían.

### Ejemplos por proveedor

**Hostinger.** Según tu plan, el correo es de Hostinger o de Titan. Mira en hPanel › Correos qué servidor
SMTP te indica:

```ini
SMTP_HOST=smtp.hostinger.com
SMTP_PORT=465
SMTP_USER=no-reply@tu-empresa.com
SMTP_PASS='la-contraseña-de-esa-casilla'
MAIL_FROM="SpiderFolio <no-reply@tu-empresa.com>"
```

Con Titan, cambia `SMTP_HOST=smtp.titan.email` (también puerto 465).

**Gmail o Google Workspace.** Gmail no acepta tu contraseña normal: activa la verificación en dos pasos de la
cuenta y crea una **contraseña de aplicación** (Cuenta de Google › Seguridad › Contraseñas de aplicaciones).
Pégala sin espacios:

```ini
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=tu-cuenta@gmail.com
SMTP_PASS='abcdefghijklmnop'
MAIL_FROM="SpiderFolio <tu-cuenta@gmail.com>"
```

**Microsoft 365.** La casilla necesita **SMTP autenticado** activado (Centro de administración de Microsoft
365 › Usuarios › la casilla › Correo › Administrar aplicaciones de correo electrónico):

```ini
SMTP_HOST=smtp.office365.com
SMTP_PORT=587
SMTP_USER=no-reply@tu-empresa.com
SMTP_PASS='la-contraseña-de-esa-casilla'
MAIL_FROM="SpiderFolio <no-reply@tu-empresa.com>"
```

Microsoft está retirando el inicio de sesión con usuario y contraseña en SMTP. Si el servidor responde
`535 5.7.139` (autenticación básica desactivada), usa un servicio transaccional (Resend, Postmark, Amazon SES…)
en lugar de la casilla de Microsoft 365.

### Comprobar que funciona

En **Administración › Seguridad**, pestaña **Email**, la tarjeta **Email del servidor** muestra si el SMTP de
la instalación funciona, el servidor y el remitente. Pulsa **Enviar email de prueba**: llega a tu propio email
y, si falla, muestra el error exacto (el motivo, el código como `EAUTH · 535` y la respuesta del servidor, con
el usuario y la contraseña tapados).

### Si el email no funciona

- Si el servidor rechaza el usuario o la contraseña (`EAUTH`, `535`) o el remitente, ese email **no se
  reintenta**: queda como fallido. Los fallos de conexión sí se reintentan unas veces antes de darse por
  fallidos.
- El propietario y los administradores reciben un aviso en la campana: «El email no está funcionando: revisa
  la configuración SMTP», con el motivo (como mucho uno por hora).
- Corrige el `.env`, recrea la app y el worker, y usa **Enviar email de prueba** hasta que llegue. Los emails
  que fallaron no se reenvían solos: pide de nuevo lo que necesites (por ejemplo, **Reenviar** una
  invitación o el email de verificación).

### Diagnóstico

Desde la carpeta de la instalación (los mismos comandos en PowerShell y en Linux):

```sh
docker compose logs --tail 100 worker
```

Busca las líneas `Email no enviado`: el campo `code` dice el motivo (`AUTH`, `CONNECTION`, `TLS`,
`SENDER_REJECTED`).

Para comprobar que la contraseña llegó bien sin mostrarla, mira cuántos caracteres tiene:

```sh
docker compose exec worker sh -c 'echo ${#SMTP_PASS}'
```

Tiene que ser el largo exacto de tu contraseña. Si da 2 más, se colaron comillas de más (por ejemplo,
`SMTP_PASS=''clave''`); si da 0, el `.env` no tiene `SMTP_PASS` o el worker no se recreó. Comprueba también
el servidor y el puerto que está usando:

```sh
docker compose exec worker sh -c 'echo $SMTP_HOST:$SMTP_PORT'
```

## El remitente propio de la empresa

Con él, los emails de tu empresa (invitaciones, avisos de documentos, compartidos) salen desde tu servidor SMTP
y con tu dirección, por ejemplo `avisos@tuempresa.com`, en lugar del remitente de la instalación.

### Dónde está

En **Administración › Seguridad**, pestaña **Email**. Necesitas la capacidad **Gestionar la seguridad**. El
propietario ve las pestañas **General** y **Email**; los administradores, solo **Email**.

Si ves «El remitente propio no está disponible en este servidor», a la instalación le falta
`EMAIL_ENCRYPTION_KEY`, la clave con la que se guarda cifrada la contraseña de tu SMTP. Pídesela a quien
administra el servidor.

### Configurarlo

1. Completa los datos del servidor:
   - **Servidor SMTP**: tiene que ser una dirección pública; no se aceptan direcciones de red interna.
   - **Puerto**: 25, 465, 587 o 2525.
   - **Seguridad**: **STARTTLS (puerto 587)** o **TLS (puerto 465)**.
   - **Usuario (opcional)** y **Contraseña**. La contraseña se guarda cifrada y no se vuelve a mostrar; para
     conservar la actual, déjala vacía.
2. Completa el remitente: **Nombre del remitente**, **Dirección del remitente** (una que tu servidor te
   permita usar) y, si quieres, **Responder a (opcional)**.
3. Pulsa **Guardar**.
4. Pulsa **Enviar email de prueba**. La prueba llega a **tu** email, nunca a otra persona. Puedes enviar hasta
   5 por hora (y 20 por hora entre toda la empresa).
5. Si la prueba llegó bien, pulsa **Activar**.

Arriba ves el estado: **Sin activar**, **Activo** o **Desactivado**, y si la configuración está **Probado** o
**Sin probar**. Si cambias algo y guardas, vuelve a **Sin activar** hasta que envíes otra prueba. Para dejar de
usarlo, pulsa **Desactivar**.

Si la prueba falla, te decimos por qué: usuario o contraseña rechazados, no se pudo conectar (revisa servidor,
puerto y seguridad), falló la conexión segura, el servidor rechazó el remitente, o no se encontró el servidor.

### Si tu servidor falla

Nadie se queda sin su aviso:

- Si un envío falla, ese email sale igual por el servidor de la instalación, con el nombre «Tu empresa (vía
  SpiderFolio)» y tu dirección como **Responder a**.
- El propietario y los administradores con **Gestionar la seguridad** reciben un aviso en la campana y por
  email (como mucho uno por hora). En la pestaña **Email** verás también el último error.
- Tras **3 fallos seguidos**, el remitente propio pasa a **Desactivado**. Corrige la configuración, envía una
  prueba y actívalo de nuevo.

### Dominio verificado

Debajo verás **Dominio verificado**: una forma de enviar desde tu dominio sin contraseña, creando registros
DNS. En esta versión aparece como «El envío con dominio verificado estará disponible próximamente».

## Que tus emails no caigan en spam

Esto vale tanto para `MAIL_FROM` de la instalación como para el remitente propio. En el DNS del dominio de la
dirección del remitente, crea estos registros con los valores que te dé tu proveedor de email (en la pestaña
**Email**, el desplegable **¿Tus emails caen en spam?** tiene la misma guía con ejemplos para copiar):

- **SPF**: un registro TXT que dice qué servidores pueden enviar por ti. Solo puede haber uno: si ya tienes,
  agrega el `include` de tu proveedor. Ejemplo: `v=spf1 include:spf.tu-proveedor.com ~all`.
- **DKIM**: tu proveedor genera una clave y te da un registro TXT o CNAME (por ejemplo,
  `selector._domainkey.tudominio.com`). Créalo tal como te lo indica.
- **DMARC**: un registro TXT en `_dmarc.tudominio.com`. Empieza con `p=none` (solo observa) y, cuando todo
  llegue bien, pasa a `quarantine`. Ejemplo: `v=DMARC1; p=none; rua=mailto:dmarc@tudominio.com`.

Para comprobarlo, envía el email de prueba a tu bandeja y mira que no esté en spam. Si cae en spam, revisa que
SPF y DKIM estén bien creados (los cambios de DNS pueden tardar unas horas) y que la dirección del remitente
sea de tu dominio.

## Auditoría

Guardar la configuración, enviar pruebas, activar, desactivar y cada envío que salió por el respaldo quedan en
el registro de auditoría, en el área **Email de la empresa**, igual que cada prueba del email del servidor
(con su resultado). Nunca se guarda la contraseña.

## Relacionado

- [Configuración](https://spiderfolio.spiderjad.com/es/docs/configuracion)
- [Invitar personas](https://spiderfolio.spiderjad.com/es/docs/invitar-personas)
- [Seguridad y verificación en dos pasos](https://spiderfolio.spiderjad.com/es/docs/seguridad-y-2fa)
