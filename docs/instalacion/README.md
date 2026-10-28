English version: [docs/install/README.md](../install/README.md)

# Instalar SpiderFolio

SpiderFolio se instala con Docker Compose. Se instalan cuatro piezas:

- **db**: la base de datos PostgreSQL 16 (sin puerto público).
- **app**: la API, que también sirve la aplicación web. Al arrancar prepara la base sola.
- **worker**: las tareas en segundo plano (emails, PDF, búsqueda, papelera…).
- Opcionales: **caddy** (HTTPS automático), **gotenberg** (PDF de los documentos controlados) y
  **mailpit** (bandeja de email de prueba).

## ¿Dónde lo vas a instalar?

Elige una opción y sigue solo su sección: cada una tiene su paso a paso completo.

| Opción | Para qué | Qué necesitas |
| --- | --- | --- |
| [Probar en tu PC](#probar-en-tu-pc) | Verlo funcionando, sin datos reales | Windows 10/11, macOS o Linux con Docker |
| [Servidor con dominio propio](#servidor-con-dominio-propio) | Uso real, con HTTPS automático | Servidor Linux, un dominio y un servidor de email |
| [Servidor con proxy propio](#servidor-con-proxy-propio) | Ya tienes nginx, Traefik, IIS u otro proxy con HTTPS | Servidor Linux, tu proxy y un servidor de email |

¿Tu empresa usa Windows Server? Mira [Windows](#windows): lo recomendado es una máquina virtual
Ubuntu dentro de Hyper-V y, desde ahí, seguir la guía de servidor.

## Probar en tu PC

Para ver SpiderFolio funcionando en tu propio equipo. Solo se entra desde ese equipo, en
`http://localhost:8080`, y los emails no salen: quedan en una bandeja de prueba (Mailpit).

### 1. Instala Docker

- **Windows 10/11**: instala Docker Desktop como se explica en
  [Windows › Probar en una PC con Windows](#probar-en-una-pc-con-windows-1011).
- **macOS**: instala Docker Desktop y usa los comandos de la pestaña Linux.
- **Linux**: instala Docker Engine (`curl -fsSL https://get.docker.com | sudo sh`).

Comprueba que funciona. Tiene que mostrar una versión, sin errores:

```sh
docker compose version
```

### 2. Descarga SpiderFolio

**Windows (PowerShell)**

En PowerShell (no hace falta Git):

```powershell
cd $HOME
$ProgressPreference = "SilentlyContinue"
$repo = "https://github.com/spiderjad/SpiderFolio"
Invoke-WebRequest "$repo/archive/refs/heads/main.zip" `
  -OutFile spiderfolio.zip
Expand-Archive spiderfolio.zip -DestinationPath .
cd SpiderFolio-main\deploy
```

**Linux**

```sh
git clone https://github.com/spiderjad/SpiderFolio.git
cd SpiderFolio/deploy
```

Todos los comandos siguientes se escriben en esa carpeta, `deploy`.

### 3. Crea la configuración (`.env`)

**Con el script (recomendado).** Pregunta dónde lo instalas, genera los secretos y escribe `.env`.
Elige la opción **1 (Probar en tu PC)**:

**Windows (PowerShell)**

```powershell
powershell -ExecutionPolicy Bypass -File .\setup.ps1
```

**Linux**

```sh
./setup.sh
```

Si usaste el script, sigue en el paso 4.

**A mano.** Copia el ejemplo:

**Windows (PowerShell)**

```powershell
copy .env.example .env
```

**Linux**

```sh
cp .env.example .env
chmod 600 .env
```

Genera los secretos. Cada comando da un valor distinto; anota cuál es cuál:

**Windows (PowerShell)**

```powershell
function New-Secret([int]$Bytes) {
  $b = New-Object byte[] $Bytes
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  $rng.GetBytes($b)
  [Convert]::ToBase64String($b)
}
# POSTGRES_PASSWORD (solo letras y números)
(New-Secret 32) -replace '[^A-Za-z0-9]', ''
# JWT_ACCESS_SECRET
New-Secret 48
# EMAIL_ENCRYPTION_KEY
New-Secret 32
# MFA_ENCRYPTION_KEY
New-Secret 32
```

**Linux**

```sh
# POSTGRES_PASSWORD (solo letras y números)
openssl rand -hex 24
# JWT_ACCESS_SECRET
openssl rand -base64 48
# EMAIL_ENCRYPTION_KEY
openssl rand -base64 32
# MFA_ENCRYPTION_KEY
openssl rand -base64 32
```

Abre `.env`:

**Windows (PowerShell)**

```powershell
notepad .env
```

**Linux**

```sh
nano .env
```

Para guardar: `Ctrl+O` y `Enter`. Para salir: `Ctrl+X`.

Cada línea es `NOMBRE=valor`. Busca estas cuatro líneas, que están vacías, y pega cada secreto
justo después del `=`, sin espacios ni comillas:

```ini
POSTGRES_PASSWORD=pega-aquí-la-contraseña
JWT_ACCESS_SECRET=pega-aquí-el-primer-secreto
EMAIL_ENCRYPTION_KEY=pega-aquí-la-primera-clave
MFA_ENCRYPTION_KEY=pega-aquí-la-segunda-clave
```

El resto ya viene listo para probar en tu PC. Comprueba que estas líneas digan esto:

```ini
APP_URL=http://localhost:8080
WEB_URL=http://localhost:8080
DOMAIN=
COMPOSE_PROFILES=mail
SMTP_HOST=mailpit
SMTP_PORT=1025
```

Guarda el archivo. `DOMAIN` queda vacío: solo se usa con HTTPS automático.

### 4. Arranca

```sh
docker compose up -d
```

La primera vez descarga las imágenes (unos minutos). Para ver el progreso de la app:

```sh
docker compose logs -f app
```

Cuando aparece la línea `API lista`, ya está. Sal del log con `Ctrl+C` (la app sigue en marcha).

### 5. Comprueba

**Windows (PowerShell)**

```powershell
curl.exe http://localhost:8080/api/health
```

**Linux**

```sh
curl http://localhost:8080/api/health
```

Tiene que responder:

```json
{"status":"ok"}
```

Si no responde o da error, mira [Problemas típicos](#problemas-típicos) y
[Solución de problemas](https://spiderfolio.spiderjad.com/es/docs/solucion-de-problemas).

### 6. Crea tu cuenta

1. Abre `http://localhost:8080` en el navegador y pulsa **Crear cuenta**. Quedas como propietario.
2. El email de verificación llega a la bandeja de prueba: abre `http://localhost:8025` y pulsa el
   enlace del email.

Sigue con [Primer administrador](https://spiderfolio.spiderjad.com/es/docs/primer-administrador).

### Para apagarlo

```sh
docker compose down
```

Los datos quedan guardados: `docker compose up -d` lo vuelve a levantar. Para borrar también todos
los datos de la prueba: `docker compose down -v` (no se puede deshacer).

## Servidor con dominio propio

Para usarlo en serio: cualquier persona entra con HTTPS a una dirección como
`https://docs.tu-empresa.com`. Caddy pide y renueva el certificado solo (Let's Encrypt).

### 1. Prepara el servidor

Necesitas:

- Un servidor **Linux** (por ejemplo, Ubuntu 24.04 LTS) con **2 vCPU y 4 GB de RAM** para una empresa
  de hasta unas 200 personas. Detalle en [Requisitos del servidor](https://spiderfolio.spiderjad.com/es/docs/requisitos-del-servidor).
- Un **dominio** (o subdominio) con un registro DNS `A` que apunte a la IP pública del servidor.
- Los puertos **80 y 443** abiertos hacia el servidor (firewall y router).
- Un **servidor de email (SMTP)**: el de tu empresa o un servicio transaccional (Resend, Postmark,
  Amazon SES…). Ten a mano el host, el puerto, el usuario y la contraseña.

Instala Docker y comprueba que funciona:

```sh
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
```

Cierra la sesión y vuelve a entrar (para usar `docker` sin `sudo`). Después:

```sh
docker compose version
```

### 2. Descarga SpiderFolio

```sh
git clone https://github.com/spiderjad/SpiderFolio.git
cd SpiderFolio/deploy
```

Todos los comandos siguientes se escriben en esa carpeta, `deploy`.

### 3. Crea la configuración (`.env`)

**Con el script (recomendado).** Elige la opción **2 (Servidor con dominio propio)** y responde el
dominio y los datos del email:

```sh
./setup.sh
```

Si usaste el script, sigue en el paso 4.

**A mano.** Copia el ejemplo y genera los secretos. Cada comando da un valor distinto; anota cuál es
cuál:

```sh
cp .env.example .env
chmod 600 .env
# POSTGRES_PASSWORD (solo letras y números)
openssl rand -hex 24
# JWT_ACCESS_SECRET
openssl rand -base64 48
# EMAIL_ENCRYPTION_KEY
openssl rand -base64 32
# MFA_ENCRYPTION_KEY
openssl rand -base64 32
```

Abre `.env` con `nano .env` (guardar: `Ctrl+O` y `Enter`; salir: `Ctrl+X`). Cada línea es
`NOMBRE=valor`: escribe el valor justo después del `=`, sin espacios. Cambia estas líneas (con tu
dominio en lugar de `docs.tu-empresa.com`):

```ini
APP_URL=https://docs.tu-empresa.com
WEB_URL=https://docs.tu-empresa.com
DOMAIN=docs.tu-empresa.com
COMPOSE_PROFILES=https
POSTGRES_PASSWORD=pega-aquí-la-contraseña
JWT_ACCESS_SECRET=pega-aquí-el-primer-secreto
EMAIL_ENCRYPTION_KEY=pega-aquí-la-primera-clave
MFA_ENCRYPTION_KEY=pega-aquí-la-segunda-clave
SMTP_HOST=smtp.tu-proveedor.com
SMTP_PORT=587
SMTP_USER=tu-usuario-smtp
SMTP_PASS='tu-contraseña-smtp'
MAIL_FROM="SpiderFolio <no-reply@tu-empresa.com>"
```

- `DOMAIN` va sin `https://`; `APP_URL` y `WEB_URL`, con `https://`.
- `WEB_URL` es la web pública del proyecto (documentación y textos legales). En una instalación
  propia, pon la misma `APP_URL`.
- `SMTP_PASS` va entre comillas simples, así los caracteres como `$` o `#` se leen tal cual.

Guarda una copia de `.env` en un lugar seguro: sin `MFA_ENCRYPTION_KEY` nadie puede volver a entrar
con su verificación en dos pasos. Todas las variables están en [Configuración](https://spiderfolio.spiderjad.com/es/docs/configuracion).

### 4. Arranca

```sh
docker compose up -d
docker compose logs -f app
```

Cuando aparece la línea `API lista`, ya está. Sal del log con `Ctrl+C`. Caddy pide el certificado en
el primer minuto; lo ves con `docker compose logs caddy`.

### 5. Comprueba

En el propio servidor, sin pasar por HTTPS:

```sh
curl http://localhost:8080/api/health
```

Y desde fuera, con tu dominio:

```sh
curl https://docs.tu-empresa.com/api/health
```

Los dos tienen que responder:

```json
{"status":"ok"}
```

Si el primero responde y el segundo no, revisa el DNS y los puertos 80 y 443
([Proxy y HTTPS](https://spiderfolio.spiderjad.com/es/docs/proxy-y-https)). Si ninguno responde, mira
[Solución de problemas](https://spiderfolio.spiderjad.com/es/docs/solucion-de-problemas).

### 6. Crea tu empresa

Abre tu dominio en el navegador, pulsa **Crear cuenta**, verifica tu email y quedas como propietario.
Sigue con [Primer administrador](https://spiderfolio.spiderjad.com/es/docs/primer-administrador) y programa las
[copias de seguridad](https://spiderfolio.spiderjad.com/es/docs/copias-de-seguridad) antes de cargar datos reales.

## Servidor con proxy propio

Para cuando ya tienes un proxy con HTTPS (nginx, Traefik, IIS, un balanceador…). SpiderFolio no
abre los puertos 80 y 443: escucha en `127.0.0.1:8080` y tu proxy le pasa el tráfico.

### 1. Prepara el servidor

Necesitas:

- Un servidor **Linux** (por ejemplo, Ubuntu 24.04 LTS) con **2 vCPU y 4 GB de RAM** para una empresa
  de hasta unas 200 personas. Detalle en [Requisitos del servidor](https://spiderfolio.spiderjad.com/es/docs/requisitos-del-servidor).
- Tu **proxy con HTTPS** y la dirección con la que se va a entrar (por ejemplo,
  `https://docs.tu-empresa.com`).
- Un **servidor de email (SMTP)**: el de tu empresa o un servicio transaccional (Resend, Postmark,
  Amazon SES…). Ten a mano el host, el puerto, el usuario y la contraseña.

Instala Docker y comprueba que funciona:

```sh
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
```

Cierra la sesión y vuelve a entrar (para usar `docker` sin `sudo`). Después:

```sh
docker compose version
```

### 2. Descarga SpiderFolio

```sh
git clone https://github.com/spiderjad/SpiderFolio.git
cd SpiderFolio/deploy
```

Todos los comandos siguientes se escriben en esa carpeta, `deploy`.

### 3. Crea la configuración (`.env`)

**Con el script (recomendado).** Elige la opción **3 (Servidor con proxy propio)** y responde la URL
y los datos del email:

```sh
./setup.sh
```

Si usaste el script, sigue en el paso 4.

**A mano.** Copia el ejemplo y genera los secretos. Cada comando da un valor distinto; anota cuál es
cuál:

```sh
cp .env.example .env
chmod 600 .env
# POSTGRES_PASSWORD (solo letras y números)
openssl rand -hex 24
# JWT_ACCESS_SECRET
openssl rand -base64 48
# EMAIL_ENCRYPTION_KEY
openssl rand -base64 32
# MFA_ENCRYPTION_KEY
openssl rand -base64 32
```

Abre `.env` con `nano .env` (guardar: `Ctrl+O` y `Enter`; salir: `Ctrl+X`). Cada línea es
`NOMBRE=valor`: escribe el valor justo después del `=`, sin espacios. Cambia estas líneas (con tu
dirección en lugar de `docs.tu-empresa.com`):

```ini
APP_URL=https://docs.tu-empresa.com
WEB_URL=https://docs.tu-empresa.com
DOMAIN=
COMPOSE_PROFILES=
POSTGRES_PASSWORD=pega-aquí-la-contraseña
JWT_ACCESS_SECRET=pega-aquí-el-primer-secreto
EMAIL_ENCRYPTION_KEY=pega-aquí-la-primera-clave
MFA_ENCRYPTION_KEY=pega-aquí-la-segunda-clave
SMTP_HOST=smtp.tu-proveedor.com
SMTP_PORT=587
SMTP_USER=tu-usuario-smtp
SMTP_PASS='tu-contraseña-smtp'
MAIL_FROM="SpiderFolio <no-reply@tu-empresa.com>"
```

- `DOMAIN` y `COMPOSE_PROFILES` quedan vacíos: el HTTPS lo pone tu proxy.
- `WEB_URL` es la web pública del proyecto (documentación y textos legales). En una instalación
  propia, pon la misma `APP_URL`.
- `SMTP_PASS` va entre comillas simples, así los caracteres como `$` o `#` se leen tal cual.
- Si el proxy está en **otra máquina**, cambia `HTTP_BIND=127.0.0.1` por la IP de este servidor en la
  red interna, y permite el puerto 8080 solo desde el proxy.

Guarda una copia de `.env` en un lugar seguro: sin `MFA_ENCRYPTION_KEY` nadie puede volver a entrar
con su verificación en dos pasos. Todas las variables están en [Configuración](https://spiderfolio.spiderjad.com/es/docs/configuracion).

### 4. Arranca

```sh
docker compose up -d
docker compose logs -f app
```

Cuando aparece la línea `API lista`, ya está. Sal del log con `Ctrl+C`.

### 5. Configura tu proxy

Tu proxy tiene que pasar todo el tráfico de tu dirección a `http://127.0.0.1:8080` (o a la IP que
pusiste en `HTTP_BIND`), con las cabeceras `X-Forwarded-For` y `X-Forwarded-Proto`, y aceptar
subidas de archivos grandes. Hay ejemplos para nginx y Traefik en
[Proxy y HTTPS](https://spiderfolio.spiderjad.com/es/docs/proxy-y-https).

### 6. Comprueba

En el propio servidor, sin pasar por el proxy:

```sh
curl http://localhost:8080/api/health
```

Y a través de tu proxy:

```sh
curl https://docs.tu-empresa.com/api/health
```

Los dos tienen que responder:

```json
{"status":"ok"}
```

Si el primero responde y el segundo no, el problema está en el proxy. Si ninguno responde, mira
[Solución de problemas](https://spiderfolio.spiderjad.com/es/docs/solucion-de-problemas).

### 7. Crea tu empresa

Abre tu dirección en el navegador, pulsa **Crear cuenta**, verifica tu email y quedas como
propietario. Sigue con [Primer administrador](https://spiderfolio.spiderjad.com/es/docs/primer-administrador) y programa las
[copias de seguridad](https://spiderfolio.spiderjad.com/es/docs/copias-de-seguridad) antes de cargar datos reales.

## Windows

### Probar en una PC con Windows 10/11

1. **Activa WSL2.** Abre PowerShell como administrador (clic derecho en Inicio › Terminal
   (administrador)) y ejecuta:

   ```powershell
   wsl --install
   ```

   Reinicia la PC cuando lo pida.

2. **Instala Docker Desktop** desde [docker.com](https://www.docker.com/products/docker-desktop/).
   En la instalación deja marcada la opción **Use WSL 2**.
3. **Abre Docker Desktop** y espera a que abajo a la izquierda diga **Engine running**.
4. **Comprueba** en una ventana de PowerShell normal:

   ```powershell
   docker compose version
   docker run --rm hello-world
   ```

   El segundo comando tiene que mostrar `Hello from Docker!`.

5. Sigue [Probar en tu PC](#probar-en-tu-pc) con los comandos de la pestaña **Windows (PowerShell)**.

### Producción en una empresa con Windows Server

Docker en Windows no está pensado para un servidor que funcione 24/7: Docker Desktop necesita una
sesión de usuario abierta, se actualiza solo y su licencia es de pago en empresas grandes; y el
Docker de Windows Server ejecuta contenedores de Windows, no los de Linux que usa SpiderFolio.

Lo recomendado es una **máquina virtual Ubuntu en Hyper-V**, que viene incluido en Windows Server.
La máquina virtual arranca con el servidor y SpiderFolio corre dentro como en cualquier Linux.

1. **Activa Hyper-V.** En PowerShell como administrador (el servidor se reinicia):

   ```powershell
   Install-WindowsFeature -Name Hyper-V `
     -IncludeManagementTools -Restart
   ```

2. **Crea un conmutador virtual** conectado a la red, para que la máquina virtual tenga su propia IP.
   Busca el nombre de tu placa de red con `Get-NetAdapter` y úsalo en lugar de `Ethernet`:

   ```powershell
   New-VMSwitch -Name "Externo" `
     -NetAdapterName "Ethernet" -AllowManagementOS $true
   ```

3. **Descarga Ubuntu Server 24.04 LTS** (archivo `.iso`) desde
   [ubuntu.com/download/server](https://ubuntu.com/download/server) y guárdalo, por ejemplo, en
   `C:\ISO\ubuntu-24.04-live-server-amd64.iso`.
4. **Crea la máquina virtual** (2 vCPU, 4 GB de RAM, 100 GB de disco):

   ```powershell
   $vm = @{
     Name               = "spiderfolio"
     Generation         = 2
     MemoryStartupBytes = 4GB
     NewVHDPath         = "C:\Hyper-V\spiderfolio.vhdx"
     NewVHDSizeBytes    = 100GB
     SwitchName         = "Externo"
   }
   New-VM @vm
   Set-VMProcessor spiderfolio -Count 2
   Set-VMMemory spiderfolio -DynamicMemoryEnabled $false
   $iso = "C:\ISO\ubuntu-24.04-live-server-amd64.iso"
   Add-VMDvdDrive spiderfolio -Path $iso
   Set-VMFirmware spiderfolio `
     -SecureBootTemplate MicrosoftUEFICertificateAuthority `
     -FirstBootDevice (Get-VMDvdDrive spiderfolio)
   Set-VM spiderfolio -AutomaticStartAction Start `
     -AutomaticStopAction ShutDown
   Start-VM spiderfolio
   ```

5. **Instala Ubuntu.** Abre la consola de la máquina virtual (Administrador de Hyper-V › doble clic
   en `spiderfolio`) y sigue el instalador con las opciones por defecto. Marca **Install OpenSSH
   server** para administrarla después por SSH. Al terminar, quita el disco de instalación:

   ```powershell
   Get-VMDvdDrive spiderfolio | Remove-VMDvdDrive
   ```

6. **Dale una IP fija** a la máquina virtual (una reserva en tu DHCP o en el instalador de Ubuntu).
   Desde la máquina virtual la ves con `ip -4 addr`.
7. **Sigue la guía de servidor** dentro de Ubuntu: [Servidor con dominio propio](#servidor-con-dominio-propio)
   (el router o firewall tiene que llevar los puertos 80 y 443 a la IP de la máquina virtual) o
   [Servidor con proxy propio](#servidor-con-proxy-propio) (por ejemplo, IIS con ARR en el
   Windows Server, apuntando a `http://IP-de-la-máquina-virtual:8080`, con `HTTP_BIND` igual a esa
   IP).

Las [copias de seguridad](https://spiderfolio.spiderjad.com/es/docs/copias-de-seguridad) se hacen dentro de Ubuntu, como en cualquier
servidor; copia la carpeta de copias fuera de la máquina virtual.

### Problemas típicos

- **Docker Desktop no está en marcha.** El error dice
  `failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine` o
  `El sistema no puede encontrar el archivo especificado`. Abre Docker Desktop y espera a
  **Engine running**. Si no termina de arrancar, ejecuta `wsl --update` y reinicia; si sigue igual,
  activa la virtualización en la BIOS.
- **Puerto ocupado.** El error dice `port is already allocated` o `ports are not available`. Mira qué
  programa usa el puerto:

  ```powershell
  Get-NetTCPConnection -LocalPort 8080 -State Listen |
    ForEach-Object { Get-Process -Id $_.OwningProcess }
  ```

  Ciérralo o usa otro puerto: en `.env`, `HTTP_PORT=8081`, `APP_URL=http://localhost:8081` y
  `WEB_URL=http://localhost:8081`. Si el ocupado es el 8025 (Mailpit), cambia `MAIL_UI_PORT`.
  Después, `docker compose up -d`.
- **El Bloc de notas lo guardó como `.env.txt`.** Docker no lo encuentra y dice que falta
  `POSTGRES_PASSWORD`. Compruébalo y renómbralo:

  ```powershell
  Get-ChildItem -Force
  Rename-Item .env.txt .env
  ```

  Para evitarlo, abre el archivo con `notepad .env` y, si usas **Guardar como**, elige
  **Todos los archivos (\*.\*)** en el tipo.
- **Saltos de línea.** Si copias `setup.sh` o `.env` desde Windows a un servidor Linux, pueden llegar
  con saltos de línea de Windows (CRLF) y fallar con `bad interpreter` o con valores raros. En el
  servidor, conviértelos:

  ```sh
  sed -i 's/\r$//' setup.sh .env
  ```

  El `.env` que escribe `setup.ps1` ya usa saltos de línea de Linux.
- **«La ejecución de scripts está deshabilitada en este sistema».** Ejecuta el script como dice la
  guía, con `powershell -ExecutionPolicy Bypass -File .\setup.ps1`: no cambia nada del sistema.

## Opcional

- **PDF de los documentos controlados** (Gotenberg): en `.env`, agrega `pdf` a `COMPOSE_PROFILES`
  (por ejemplo, `COMPOSE_PROFILES=https,pdf`) y pon `GOTENBERG_URL=http://gotenberg:3000`. Después,
  `docker compose up -d`. Sin Gotenberg todo funciona igual, salvo ese PDF. Ver
  [Gotenberg](https://spiderfolio.spiderjad.com/es/docs/gotenberg).
- **Archivos en S3** (R2, MinIO, AWS…): `STORAGE_DRIVER=s3` y las variables `S3_*`. Por defecto los
  archivos van al volumen `files`. Ver [Almacenamiento](https://spiderfolio.spiderjad.com/es/docs/almacenamiento).
- **Bian, el asistente IA**: `BIAN_ENABLED=true` y `ANTHROPIC_API_KEY` (las consultas se cobran en tu
  cuenta de Anthropic).
- **Límites**: por defecto no hay ninguno. Cada empresa fija almacenamiento, tamaño de archivo,
  versiones guardadas y retención de la auditoría en Administración › Límites y uso.
- **Backoffice de la instalación** (`/internal`: empresas y su uso): marca a quien administra el
  servidor (con su email) y pídele activar la verificación en dos pasos:

  ```sh
  docker compose exec db psql -U spiderfolio -c \
    "UPDATE \"User\" SET \"isStaff\" = true
     WHERE email = 'tu@email.com';"
  ```

- **Compilar la imagen tú mismo** (por ejemplo, con plugins): desde la carpeta `deploy`,
  `docker compose build` y después `docker compose up -d`.

## Después de instalar

- [Copias de seguridad](https://spiderfolio.spiderjad.com/es/docs/copias-de-seguridad): prográmalas antes de cargar datos reales.
- [Actualizaciones](https://spiderfolio.spiderjad.com/es/docs/actualizaciones): `docker compose pull` y `docker compose up -d`.
- [Configuración](https://spiderfolio.spiderjad.com/es/docs/configuracion): todas las variables de `.env`.
- [Solución de problemas](https://spiderfolio.spiderjad.com/es/docs/solucion-de-problemas).

En este repositorio: [Actualizar](actualizar.md) · [Copias de seguridad y restauración](copias-de-seguridad.md) ·
[Plugins comerciales](plugins.md) · variables completas en `deploy/.env.example` y `docs/spec/entorno.md`.
