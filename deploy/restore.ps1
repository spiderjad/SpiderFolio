# Restores a copy made with backup.ps1 or backup.sh (docs/instalacion/copias-de-seguridad.md). It
# REPLACES the current database and files. Run it from the installation folder, with the services
# created (docker compose up -d):
#   powershell -ExecutionPolicy Bypass -File .\restore.ps1 .\backups\20261026-030000
# Works with Windows PowerShell 5.1 and PowerShell 7. Like backup.ps1, no binary data goes through
# PowerShell's pipeline: the dump is copied into the container and tar reads the mounted copy folder.
param(
  [Parameter(Mandatory = $true)][string]$Source
)
$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

function Invoke-Docker {
  & docker @args
  if ($LASTEXITCODE -ne 0) { throw "docker $($args -join ' ') failed ($LASTEXITCODE)" }
}

function Get-EnvValue([string]$Name, [string]$Default) {
  $line = Get-Content -LiteralPath ".env" | Where-Object { $_ -match "^$Name=" } | Select-Object -First 1
  if ($null -eq $line) { return $Default }
  $value = $line.Substring($Name.Length + 1)
  if ($value -eq "") { return $Default }
  return $value
}

if (-not (Test-Path -LiteralPath $Source -PathType Container)) { throw "No existe la carpeta $Source" }
$src = (Resolve-Path -LiteralPath $Source).Path
$dump = Join-Path $src "db.dump"
if (-not (Test-Path -LiteralPath $dump) -or -not (Test-Path -LiteralPath (Join-Path $src "files.tar.gz"))) {
  Write-Host "No es una copia de backup.ps1 o backup.sh / Not a backup.ps1 or backup.sh copy"
  exit 1
}
$user = Get-EnvValue "POSTGRES_USER" "spiderfolio"
$database = Get-EnvValue "POSTGRES_DB" "spiderfolio"

$answer = Read-Host "Esto reemplaza la base y los archivos actuales por los de $src. Escribe RESTAURAR para seguir"
if ($answer -cne "RESTAURAR") {
  Write-Host "Cancelado"
  exit 1
}

Write-Host "-> Deteniendo la app y el worker / Stopping the app and the worker..."
Invoke-Docker compose stop app worker

Write-Host "-> Base de datos / Database..."
$tmp = "/tmp/spiderfolio-restore.dump"
Invoke-Docker compose cp $dump "db:$tmp"
Invoke-Docker compose exec -T db dropdb -U $user --if-exists $database
Invoke-Docker compose exec -T db createdb -U $user $database
Invoke-Docker compose exec -T db pg_restore -U $user -d $database --no-owner $tmp
Invoke-Docker compose exec -T db rm -f $tmp

Write-Host "-> Archivos / Files..."
Invoke-Docker compose run --rm --no-deps -T -v "${src}:/backup:ro" --entrypoint sh app -c `
  'rm -rf /data/files/* /data/files/.[!.]* 2>/dev/null; tar -C /data/files -xzf /backup/files.tar.gz'

Write-Host "-> Arrancando / Starting..."
Invoke-Docker compose up -d
Write-Host "Restauración terminada. Revisa la app y el registro de auditoría."
Write-Host "Restore finished. Check the app and the audit log."
