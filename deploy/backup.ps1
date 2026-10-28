# SpiderFolio backup on Windows (docs/instalacion/copias-de-seguridad.md): the same copy as
# backup.sh, so a copy made here restores on Linux and the other way round. The database (pg_dump,
# custom format), the files of the "files" volume and .env, in a folder named with the UTC date.
# Run it from the installation folder (where compose.yaml is):
#   powershell -ExecutionPolicy Bypass -File .\backup.ps1 [destination-folder]   (default .\backups)
# Keeps the last KEEP copies (14 by default; -Keep 30 or $env:KEEP).
# Works with Windows PowerShell 5.1 and PowerShell 7. No binary data goes through PowerShell's pipeline
# (5.1 would turn it into text): pg_dump writes inside the container and tar into the copy folder.
param(
  [string]$Destination = ".\backups",
  [int]$Keep = $(if ($env:KEEP) { [int]$env:KEEP } else { 14 })
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

if (-not (Test-Path -LiteralPath ".env")) { throw "Falta .env: corre el script desde la carpeta de la instalación" }
$user = Get-EnvValue "POSTGRES_USER" "spiderfolio"
$database = Get-EnvValue "POSTGRES_DB" "spiderfolio"

$stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMdd-HHmmss")
New-Item -ItemType Directory -Force -Path $Destination | Out-Null
$root = (Resolve-Path -LiteralPath $Destination).Path
$out = Join-Path $root $stamp
New-Item -ItemType Directory -Path $out | Out-Null

Write-Host "-> Base de datos / Database..."
$tmp = "/tmp/spiderfolio-backup.dump"
Invoke-Docker compose exec -T db pg_dump -U $user -d $database --format=custom --no-owner -f $tmp
Invoke-Docker compose cp "db:$tmp" (Join-Path $out "db.dump")
Invoke-Docker compose exec -T db rm -f $tmp

Write-Host "-> Archivos / Files..."
Invoke-Docker compose run --rm --no-deps -T -v "${out}:/backup" --entrypoint tar app `
  -C /data/files -czf /backup/files.tar.gz .

Write-Host "-> Configuración / Configuration (.env, solo para tu usuario / for your user only)..."
$envCopy = Join-Path $out "env"
Copy-Item -LiteralPath ".env" -Destination $envCopy
# Like chmod 600: no inherited permissions, only the current user.
& icacls $envCopy /inheritance:r /grant:r "$($env:USERNAME):F" | Out-Null

# Rotation: removes the oldest copies (folder names sort by date).
$copies = @(Get-ChildItem -LiteralPath $root -Directory | Where-Object { $_.Name -match '^\d{8}-\d{6}$' } |
  Sort-Object Name)
if ($copies.Count -gt $Keep) {
  $copies | Select-Object -First ($copies.Count - $Keep) | ForEach-Object {
    Remove-Item -LiteralPath $_.FullName -Recurse -Force
  }
}
Write-Host "Copia lista en / Backup ready in $out"
