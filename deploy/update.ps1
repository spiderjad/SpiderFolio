# Updates SpiderFolio in one command on Windows (docs/instalacion/actualizar.md), like update.sh. Run it
# from the installation folder (where compose.yaml is):
#   powershell -ExecutionPolicy Bypass -File .\update.ps1            the latest version
#   powershell -ExecutionPolicy Bypass -File .\update.ps1 0.5.1      that version
# In order: checks the installed plugins with the new version (and stops if one won't load, before
# touching anything), makes a backup (backup.ps1), puts the new version's files over this folder
# (never .env, backups or the data), adds to .env the variables the new version brings (never
# changing yours), pins SPIDERFOLIO_IMAGE to the new version if it had a fixed one, and runs
# docker compose pull and up -d. Never down -v. At the end, how to go back.
# Works with Windows PowerShell 5.1 and PowerShell 7. .env is read and written as UTF-8 (it has
# accented comments).
param([string]$Version = "")
$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot
$repo = "spiderjad/SpiderFolio"
$utf8 = New-Object System.Text.UTF8Encoding($false)
$envFile = Join-Path $PSScriptRoot ".env"
$versionPattern = '^\d+\.\d+\.\d+$'

function Fail([string]$Message) {
  Write-Host "ERROR: $Message" -ForegroundColor Red
  exit 1
}
if (-not (Test-Path -LiteralPath $envFile) -or -not (Test-Path -LiteralPath "compose.yaml")) {
  Fail "Corre el script desde la carpeta de la instalación (donde están .env y compose.yaml)."
}
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Fail "Falta Docker." }
# TLS 1.2 for GitHub on Windows PowerShell 5.1.
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

function Read-EnvText { return [System.IO.File]::ReadAllText($envFile, $utf8) }
function Write-EnvText([string]$Text) { [System.IO.File]::WriteAllText($envFile, $Text, $utf8) }
function Get-EnvValue([string]$Name) {
  $match = [regex]::Matches((Read-EnvText), "(?m)^$Name=([^\r\n]*)") | Select-Object -Last 1
  if ($null -eq $match) { return "" }
  return $match.Groups[1].Value
}
function Get-RunningVersion {
  $value = (& docker compose exec -T app printenv SPIDERFOLIO_VERSION 2>$null | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) { return "" }
  return $value
}

# --- Which version ------------------------------------------------------------
$latest = ""
try {
  $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/latest" -UseBasicParsing -TimeoutSec 15
  $latest = ([string]$release.tag_name).TrimStart("v")
} catch { }
if ($Version -eq "") { $Version = $latest }
$Version = $Version.TrimStart("v")
if ($Version -notmatch $versionPattern) {
  Fail "No sé qué versión instalar (¿hay conexión a internet?). Indícala: .\update.ps1 0.5.1"
}
$current = Get-RunningVersion
if ($current -eq "") { $current = "desconocida" }
$previous = if ($current -match $versionPattern) { $current } else { "<la versión que tenías>" }
Write-Host "Versión actual: $current  ->  nueva: $Version"
if ($current -eq $Version) {
  Write-Host "Ya tienes la $Version. No hay nada que hacer."
  exit 0
}

$image = Get-EnvValue "SPIDERFOLIO_IMAGE"
if ($image -eq "") { $image = "ghcr.io/spiderjad/spiderfolio:latest" }
$base = $image.Substring(0, $image.LastIndexOf(":"))
$tag = $image.Substring($image.LastIndexOf(":") + 1)
$newImage = "${base}:$Version"
# Images before 0.5.0 don't say their version: a pinned tag does.
if ($previous -notmatch $versionPattern -and $tag -match $versionPattern) { $previous = $tag }

# --- 1. The new image and the plugins, before touching anything ---------------
Write-Host "-> Descargando la imagen $newImage..."
$env:SPIDERFOLIO_IMAGE = $newImage
try {
  & docker compose pull app
  if ($LASTEXITCODE -ne 0) { Fail "No se pudo descargar $newImage." }
  if ([version]$Version -ge [version]"0.5.0") {
    Write-Host "-> Comprobando los plugins instalados con la $Version..."
    & docker compose run --rm --no-deps -T --entrypoint node app backend/scripts/check-plugins.ts
    if ($LASTEXITCODE -ne 0) {
      Write-Host ""
      Write-Host "ALTO: con la $Version, los plugins marcados con NO dejarían de funcionar." -ForegroundColor Red
      Write-Host "No se cambió nada. Pide versiones compatibles de esos plugins (o quítalos en"
      Write-Host "Administración > Plugins > Licencia y plugins) y vuelve a correr el script."
      exit 1
    }
  } else {
    Write-Host "(La $Version no trae la comprobación de plugins: se omite.)"
  }
} finally {
  Remove-Item Env:\SPIDERFOLIO_IMAGE -ErrorAction SilentlyContinue
}

# --- 2. Backup ----------------------------------------------------------------
Write-Host "-> Copia de seguridad..."
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "backup.ps1")
if ($LASTEXITCODE -ne 0) { Fail "La copia de seguridad falló: no se cambió nada." }
$backup = Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot "backups") -Directory |
  Sort-Object Name | Select-Object -Last 1
$backupPath = ".\backups\$($backup.Name)"

# --- 3. The new version's files over this folder --------------------------------
Write-Host "-> Descargando los archivos de la $Version..."
$work = Join-Path ([System.IO.Path]::GetTempPath()) ("spiderfolio-update-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $work | Out-Null
try {
  $zip = Join-Path $work "bundle.zip"
  Invoke-WebRequest -Uri "https://github.com/$repo/releases/download/v$Version/spiderfolio-deploy.zip" -OutFile $zip -UseBasicParsing
  Expand-Archive -LiteralPath $zip -DestinationPath $work
  $stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMdd-HHmmss")
  foreach ($file in Get-ChildItem -LiteralPath (Join-Path $work "spiderfolio") -File -Force) {
    $name = $file.Name
    if ($name -eq ".env") { continue }
    $target = Join-Path $PSScriptRoot $name
    $same = (Test-Path -LiteralPath $target) -and ((Get-FileHash -LiteralPath $target).Hash -eq (Get-FileHash -LiteralPath $file.FullName).Hash)
    if ($name -eq "Caddyfile" -and (Test-Path -LiteralPath $target) -and -not $same) {
      # Your Caddyfile has changes: it stays, and the new one is left next to it.
      Copy-Item -LiteralPath $file.FullName -Destination (Join-Path $PSScriptRoot "Caddyfile.new") -Force
      Write-Host "   Caddyfile: el tuyo tiene cambios y se mantiene; el nuevo quedó en Caddyfile.new."
      continue
    }
    if ($name -eq "compose.yaml" -and (Test-Path -LiteralPath $target) -and -not $same) {
      Copy-Item -LiteralPath $target -Destination (Join-Path $PSScriptRoot "compose.yaml.bak-$stamp")
    }
    Copy-Item -LiteralPath $file.FullName -Destination $target -Force
  }
} finally {
  Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}

# --- 4. New variables in .env (never changing yours) ---------------------------
$text = Read-EnvText
$newline = if ($text.Contains("`r`n")) { "`r`n" } else { "`n" }
$added = @()
foreach ($line in [System.IO.File]::ReadAllLines((Join-Path $PSScriptRoot ".env.example"), $utf8)) {
  $match = [regex]::Match($line, '^([A-Z][A-Z0-9_]*)=')
  if (-not $match.Success) { continue }
  $key = $match.Groups[1].Value
  if ([regex]::IsMatch($text, "(?m)^$key=")) { continue }
  if ($added.Count -eq 0) {
    if (-not $text.EndsWith("`n")) { $text += $newline }
    $text += "$newline# Agregadas por update.ps1 ($Version)$newline"
  }
  $text += "$line$newline"
  $added += $key
}
Write-EnvText $text
if ($added.Count -gt 0) {
  Write-Host "   Variables nuevas agregadas a .env: $($added -join ', ')"
} else {
  Write-Host "   .env: sin variables nuevas."
}

# --- 5. The image ----------------------------------------------------------------
function Set-Image([string]$Value) {
  $text = Read-EnvText
  if ([regex]::IsMatch($text, "(?m)^SPIDERFOLIO_IMAGE=")) {
    $text = [regex]::Replace($text, "(?m)^SPIDERFOLIO_IMAGE=[^\r\n]*", "SPIDERFOLIO_IMAGE=$Value")
  } else {
    $text += "SPIDERFOLIO_IMAGE=$Value$newline"
  }
  Write-EnvText $text
}
if ($tag -match $versionPattern) {
  Set-Image $newImage
  Write-Host "   SPIDERFOLIO_IMAGE: $image -> $newImage"
} elseif ($tag -eq "latest" -and $Version -ne $latest) {
  # «latest» isn't the version asked for: it's pinned, or up -d would start another one.
  Set-Image $newImage
  Write-Host "   SPIDERFOLIO_IMAGE: fijada en $newImage (pediste una versión que no es la última)."
}

# --- 6. Start it -----------------------------------------------------------------
Write-Host "-> docker compose pull y up -d..."
& docker compose pull
if ($LASTEXITCODE -ne 0) { Fail "docker compose pull falló." }
& docker compose up -d
if ($LASTEXITCODE -ne 0) { Fail "docker compose up -d falló." }
Write-Host "-> Esperando a que la app responda (aplica las migraciones al arrancar)..."
$ready = $false
for ($i = 0; $i -lt 90 -and -not $ready; $i++) {
  Start-Sleep -Seconds 2
  & docker compose exec -T app wget -qO- http://127.0.0.1:4000/api/health 2>$null | Out-Null
  $ready = $LASTEXITCODE -eq 0
}
$running = Get-RunningVersion

Write-Host ""
if ($ready) {
  Write-Host "LISTO: SpiderFolio $running funcionando." -ForegroundColor Green
} else {
  Write-Host "La app no respondió en 3 minutos. Mira qué pasa con: docker compose logs app" -ForegroundColor Yellow
}
Write-Host ""
Write-Host "Si algo salió mal, para volver a la versión anterior:"
Write-Host "  1. En .env: SPIDERFOLIO_IMAGE=${base}:$previous"
Write-Host "  2. powershell -ExecutionPolicy Bypass -File .\restore.ps1 $backupPath"
Write-Host "     (pide escribir RESTAURAR; vuelve a arrancar con esa imagen y la base como estaba antes"
Write-Host "     de actualizar: lo hecho después se pierde)"
if (-not $ready) { exit 1 }
