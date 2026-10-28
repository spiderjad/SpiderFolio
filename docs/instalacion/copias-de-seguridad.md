English version: [docs/install/backups.md](../install/backups.md)

# Copias de seguridad y restauración

Una copia completa de SpiderFolio tiene tres partes:

- **La base de datos**: páginas, permisos, historial, auditoría… todo lo que no es un archivo.
- **Los archivos**: el volumen `files` (o tu bucket, si usas S3).
- **El `.env`**: sin él no se pueden descifrar los secretos de la verificación en dos pasos ni las
  contraseñas SMTP propias de cada empresa.

En la carpeta de la instalación (`spiderfolio`) hay dos pares de scripts que hacen lo mismo:
`backup.ps1` y `restore.ps1` para Windows (PowerShell 5.1 o 7), y `backup.sh` y `restore.sh` para Linux.
Las copias tienen el mismo formato: una copia hecha en Linux se restaura en Windows y al revés.

## Hacer una copia

Desde la carpeta de la instalación, con los servicios en marcha:

**Windows (PowerShell)**

```powershell
cd $HOME\spiderfolio
powershell -ExecutionPolicy Bypass -File .\backup.ps1 D:\Copias
```

**Linux**

```sh
cd ~/spiderfolio
./backup.sh ~/copias
```

Crea una carpeta con la fecha y la hora en UTC (por ejemplo `20261026-033000`) con:

| Archivo | Qué contiene |
| --- | --- |
| `db.dump` | La base completa (`pg_dump` en formato custom) |
| `files.tar.gz` | El contenido del volumen `files` |
| `env` | Una copia de `.env`, que solo puede leer tu usuario |

- Sin carpeta de destino, usa `backups` dentro de la instalación.
- Conserva las **últimas 14 copias** y borra las más viejas. Para cambiarlo: `-Keep 30` al final del
  comando en Windows, o `KEEP=30 ./backup.sh …` en Linux.
- La app sigue funcionando mientras se hace la copia.

## Programar una copia diaria

**Windows (PowerShell)**

Con el Programador de tareas, desde PowerShell (cambia `D:\Copias` por tu carpeta de copias):

```powershell
$dir = "$HOME\spiderfolio"
$arguments = "-NoProfile -ExecutionPolicy Bypass" +
  " -File `"$dir\backup.ps1`" D:\Copias"
$action = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument $arguments -WorkingDirectory $dir
$trigger = New-ScheduledTaskTrigger -Daily -At 3:30am
Register-ScheduledTask -TaskName "SpiderFolio backup" `
  -Action $action -Trigger $trigger
```

La tarea corre con tu usuario cuando tienes la sesión abierta, que es cuando Docker Desktop funciona.
Para comprobarla sin esperar: `Start-ScheduledTask -TaskName "SpiderFolio backup"`.

**Linux**

Con `crontab -e`, en el usuario que maneja Docker:

```cron
# Todos los días a las 3:30, en la carpeta copias de tu usuario
30 3 * * * cd ~/spiderfolio && ./backup.sh ~/copias
```

Revisa de vez en cuando que haya copias nuevas: cada copia termina con «Copia lista en …».

## Llevarlas fuera del servidor

Una copia en el mismo disco no te protege si pierdes el servidor. Cópialas a otro lugar: otro disco,
otro servidor, otro proveedor o un bucket. En Linux, por ejemplo, después de la copia:

```cron
# Todos los días a las 4:00, a otro servidor
0 4 * * * rsync -a --delete ~/copias/ copias@servidor2:/copias/
```

En Windows, guarda las copias en una unidad de red o en una carpeta sincronizada con otro equipo. Las
copias llevan el `.env` con todos los secretos: guárdalas cifradas o en un destino con acceso
restringido.

## Si usas S3

Con `STORAGE_DRIVER=s3`, `files.tar.gz` queda vacío: los archivos no están en el servidor. Protege el
bucket con las herramientas del proveedor: activa el **versionado** o una réplica en otro bucket. La base
y el `.env` se siguen copiando con los scripts.

## Restaurar

**La restauración reemplaza la base y los archivos actuales** por los de la copia. Los servicios tienen
que existir (`docker compose up -d`):

**Windows (PowerShell)**

```powershell
cd $HOME\spiderfolio
docker compose up -d
powershell -ExecutionPolicy Bypass -File .\restore.ps1 `
  D:\Copias\20261026-033000
```

**Linux**

```sh
cd ~/spiderfolio
docker compose up -d
./restore.sh ~/copias/20261026-033000
```

El script te pide que escribas `RESTAURAR` (en mayúsculas) para seguir; cualquier otra respuesta
cancela sin tocar nada. Después detiene la app y el worker, recrea la base, reemplaza los archivos y
vuelve a arrancar todo. Al terminar, entra a la app y revisa el registro de auditoría.

### En un servidor nuevo

1. Instala SpiderFolio como en [Instalar en tu servidor](https://spiderfolio.spiderjad.com/es/docs/instalar), sin crear un `.env` nuevo.
2. Copia el `env` de la copia como `.env` en la carpeta de la instalación (en Windows,
   `copy D:\Copias\20261026-033000\env .env`; en Linux, `cp …/env .env && chmod 600 .env`).
3. Arranca los servicios: `docker compose up -d`.
4. Restaura con `restore.ps1` o `restore.sh`, como arriba.
5. Si cambió la dirección del servidor, actualiza el DNS y, si hace falta, `APP_URL` y `DOMAIN`.

Puedes pasar de Windows a Linux o al revés: el formato de la copia es el mismo. Si la copia es de una
versión anterior, la app aplica las migraciones pendientes al arrancar y la pone al día sola.

## Prueba la restauración

Restaura una copia en un equipo aparte de vez en cuando, por ejemplo una vez al mes. Una copia que nunca
se restauró no es una copia.

## Relacionado

- [Actualizaciones](https://spiderfolio.spiderjad.com/es/docs/actualizaciones): haz siempre una copia antes de actualizar.
- [Almacenamiento](https://spiderfolio.spiderjad.com/es/docs/almacenamiento)
- [Solución de problemas](https://spiderfolio.spiderjad.com/es/docs/solucion-de-problemas)
