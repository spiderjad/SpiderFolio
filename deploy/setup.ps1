# Writes deploy\.env for a new installation: asks the minimum, generates the secrets and copies the
# rest from .env.example. Run it from deploy\ (docs/instalacion/README.md):
#   powershell -ExecutionPolicy Bypass -File .\setup.ps1
# Works with Windows PowerShell 5.1 and PowerShell 7.
$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

if (Test-Path -LiteralPath ".env") {
  Write-Host "Ya existe .env: no se toca (tiene tus secretos). Para empezar de cero, renómbralo."
  Write-Host ".env already exists: left untouched (it has your secrets). To start over, rename it."
  exit 1
}

function Read-Answer([string]$Question, [string]$Default) {
  $answer = Read-Host "$Question [$Default]"
  if ([string]::IsNullOrWhiteSpace($answer)) { return $Default }
  return $answer.Trim()
}

function New-RandomBytes([int]$Count) {
  $bytes = New-Object byte[] $Count
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  $rng.GetBytes($bytes)
  $rng.Dispose()
  return ,$bytes
}

Write-Host "¿Dónde lo vas a instalar? / Where will you install it?"
Write-Host "  1) Probar en tu PC / Try it on your PC"
Write-Host "  2) Servidor con dominio propio (HTTPS automático) / Server with your own domain (automatic HTTPS)"
Write-Host "  3) Servidor con proxy propio / Server behind your own proxy"
$mode = Read-Answer "Opción / Option" "1"

$domain = ""
$profiles = "mail"
$smtpHost = "mailpit"
$smtpPort = "1025"
$smtpUser = ""
$smtpPass = ""
$mailFrom = "SpiderFolio <no-reply@example.com>"
switch ($mode) {
  "1" { $appUrl = "http://localhost:8080" }
  "2" {
    $domain = Read-Answer "Dominio / Domain (docs.example.com)" ""
    $domain = ($domain -replace '^https?://', '') -replace '/.*$', ''
    if ($domain -eq "") { Write-Host "Falta el dominio / Domain is required"; exit 1 }
    $appUrl = "https://$domain"
    $profiles = "https"
  }
  "3" {
    $appUrl = (Read-Answer "URL pública / Public URL (https://docs.example.com)" "").TrimEnd("/")
    if ($appUrl -notmatch '^https?://') {
      Write-Host "La URL empieza con https:// / URL must start with https://"
      exit 1
    }
    $profiles = ""
  }
  default { Write-Host "Opción no válida / Invalid option"; exit 1 }
}

if ($mode -ne "1") {
  Write-Host "Servidor de email (SMTP) / Email server (SMTP)"
  $smtpHost = Read-Answer "SMTP host (smtp.example.com)" ""
  $smtpPort = Read-Answer "SMTP port" "587"
  $smtpUser = Read-Answer "SMTP user" ""
  # .env keeps the password between one pair of single quotes, read literally: a single quote
  # can't go inside, and quotes or spaces at either end are usually a copy mistake.
  while ($true) {
    $secure = Read-Host "SMTP password" -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    $smtpPass = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    if ($smtpPass.Contains("'")) {
      Write-Host "La contraseña tiene una comilla simple ('), que .env no admite. Escríbela de nuevo."
      Write-Host "The password has a single quote ('), which .env can't hold. Type it again."
      continue
    }
    if ($smtpPass -match '^["\s]|["\s]$') {
      Write-Host "La contraseña empieza o termina con comillas o espacios: escríbela sin comillas."
      Write-Host "The password starts or ends with quotes or spaces: type it without quotes."
      $anyway = Read-Answer "¿Usarla igual? / Use it anyway? (s/n)" "n"
      if ($anyway -notmatch '^(s|si|sí|y|yes)$') { continue }
    }
    break
  }
  # MAIL_FROM has to be the same mailbox as SMTP_USER: most servers reject any other sender.
  $fromDomain = if ($domain -ne "") { $domain } else { "example.com" }
  $fromDefault = if ($smtpUser -match "@") { $smtpUser } else { "no-reply@$fromDomain" }
  $from = Read-Answer "Remitente (igual a SMTP user) / Sender (same as SMTP user)" $fromDefault
  $mailFrom = "SpiderFolio <$from>"
}

$gotenbergUrl = ""
$pdf = Read-Answer "¿PDF de documentos controlados (Gotenberg, ~1 GB)? / Controlled-document PDF? (s/n)" "n"
if ($pdf -match '^(s|si|sí|y|yes)$') {
  $gotenbergUrl = "http://gotenberg:3000"
  $profiles = if ($profiles -eq "") { "pdf" } else { "$profiles,pdf" }
}

# Hex for the database password: base64 has / and +, which break the database URL.
$values = @{
  "APP_URL"              = $appUrl
  "WEB_URL"              = $appUrl
  "DOMAIN"               = $domain
  "COMPOSE_PROFILES"     = $profiles
  "POSTGRES_PASSWORD"    = (-join ((New-RandomBytes 24) | ForEach-Object { $_.ToString("x2") }))
  "JWT_ACCESS_SECRET"    = [Convert]::ToBase64String((New-RandomBytes 48))
  "EMAIL_ENCRYPTION_KEY" = [Convert]::ToBase64String((New-RandomBytes 32))
  "MFA_ENCRYPTION_KEY"   = [Convert]::ToBase64String((New-RandomBytes 32))
  "SMTP_HOST"            = $smtpHost
  "SMTP_PORT"            = $smtpPort
  "SMTP_USER"            = $smtpUser
  # Single quotes: compose reads the value literally ($, # and spaces are common in passwords).
  "SMTP_PASS"            = "'$smtpPass'"
  "MAIL_FROM"            = "`"$mailFrom`""
  "GOTENBERG_URL"        = $gotenbergUrl
}

$lines = foreach ($line in (Get-Content -LiteralPath ".env.example" -Encoding UTF8)) {
  if ($line -match '^([A-Z_]+)=' -and $values.ContainsKey($Matches[1])) {
    "$($Matches[1])=$($values[$Matches[1]])"
  } else {
    $line
  }
}
# UTF-8 without BOM and LF line endings, as docker compose expects.
$utf8 = New-Object Text.UTF8Encoding $false
[IO.File]::WriteAllText((Join-Path $PSScriptRoot ".env"), (($lines -join "`n") + "`n"), $utf8)

Write-Host ""
Write-Host "Listo: .env creado. Guarda una copia en un lugar seguro."
Write-Host "Done: .env created. Keep a copy somewhere safe."
Write-Host ""
Write-Host "Ahora / Now:  docker compose up -d"
Write-Host "Después abre / Then open:  $appUrl"
if ($mode -eq "1") { Write-Host "Emails de prueba / Test emails:  http://localhost:8025" }
