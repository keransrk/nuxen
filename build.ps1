# NUXEN Build Script
# Usage:
#   powershell -ExecutionPolicy Bypass -File build.ps1
#   powershell -ExecutionPolicy Bypass -File build.ps1 -release

param(
  [switch]$release
)

$ErrorActionPreference = "Stop"

# Lire la version depuis src/version.ts
$versionLine = Get-Content "src\version.ts" | Where-Object { $_ -match "APP_VERSION" }
$version = ($versionLine -replace ".*'([\d.]+)'.*", '$1').Trim()
if (-not $version -or $version -eq $versionLine) {
  $version = ($versionLine -replace '.*"([\d.]+)".*', '$1').Trim()
}
$exeName = "Nuxen-$version.exe"
$zipName = "Nuxen-$version.zip"
Write-Host "NUXEN v$version -> $zipName" -ForegroundColor Cyan

# Tuer tout process NUXEN en cours
Get-Process | Where-Object { $_.Name -like "Nuxen*" } | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

# Installer les dependances
Write-Host "Installation des dependances..." -ForegroundColor Yellow
bun install

# Build
Write-Host "Compilation $exeName..." -ForegroundColor Yellow
bun build src/main.tsx `
  --compile `
  --target=bun-windows-x64 `
  --outfile $exeName `
  --minify

Write-Host "$exeName compile (v$version)" -ForegroundColor Green

# Compression UPX desactivee : les executables UPX sont souvent bloques par Windows Defender
# La taille sera ~113MB mais sans faux positif antivirus
Write-Host "UPX desactive (evite les blocages Windows Defender)" -ForegroundColor Gray

# ─── Creer le zip de distribution ────────────────────────────────────────────
Write-Host "Creation du zip de distribution $zipName..." -ForegroundColor Yellow

$tempDist = "dist_temp_$version"
if (Test-Path $tempDist) { Remove-Item -Recurse -Force $tempDist }
New-Item -ItemType Directory -Force -Path "$tempDist\Proxies" | Out-Null
New-Item -ItemType Directory -Force -Path "$tempDist\TicketMaster" | Out-Null
New-Item -ItemType Directory -Force -Path "$tempDist\Queue-it" | Out-Null

# Copier l'exe
Copy-Item $exeName "$tempDist\$exeName"

# config.json template
$configJson = @{
  capsolver_api_key = "CAP-XXXXX_REMPLACER_PAR_VOTRE_CLE"
  default_webhook_url = "https://discord.com/api/webhooks/REMPLACER"
  discord_user_id_to_ping = ""
  poll_status_max_minutes = 30
  request_delay_ms = 3000
  license_key = ""
} | ConvertTo-Json
[System.IO.File]::WriteAllText("$tempDist\config.json", $configJson)

# Proxies/proxies.txt
$proxiesTxt = @"
# Un proxy par ligne (format: user:pass@host:port)
# NE PAS mettre http:// devant - ajoute automatiquement
10028496:HTC0V7oRwHA67_country-FRANCE_session-11111111@proxy-eu.packetstream.vip:31112
10028496:HTC0V7oRwHA67_country-FRANCE_session-22222222@proxy-eu.packetstream.vip:31112
"@
[System.IO.File]::WriteAllText("$tempDist\Proxies\proxies.txt", $proxiesTxt)

# TicketMaster/example.csv
$exampleCsv = @"
Mode,Url,Price_min,Price_max,Quantity_min,Quantity_max,Proxy_File,Accept_Contigous,Section,Offer_Code,Dates,Webhook
Drop,https://www.ticketmaster.fr/fr/manifestation/jul-billet/idmanif/640199,30,300,2,3,proxies.txt,true,406,,13/11/2026,
Drop,,,,,,proxies.txt,true,,,,
"@
[System.IO.File]::WriteAllText("$tempDist\TicketMaster\example.csv", $exampleCsv)

# Queue-it placeholder
[System.IO.File]::WriteAllText("$tempDist\Queue-it\README.txt", "Module Queue-it standalone - a venir.`n")

# Zipper
if (Test-Path $zipName) { Remove-Item -Force $zipName }
Compress-Archive -Path "$tempDist\*" -DestinationPath $zipName -Force
Remove-Item -Recurse -Force $tempDist

$zipSize = [math]::Round((Get-Item $zipName).Length / 1MB, 1)
Write-Host "Zip cree : $zipName ($zipSize MB)" -ForegroundColor Green

# Release GitHub
if ($release) {
  Write-Host ""
  Write-Host "Creation de la GitHub Release v$version..." -ForegroundColor Magenta

  $ghPath = $null
  $ghCmd = Get-Command gh -ErrorAction SilentlyContinue
  if ($ghCmd) { $ghPath = $ghCmd.Source }
  if (-not $ghPath -and (Test-Path ".\gh.exe")) { $ghPath = ".\gh.exe" }

  if (-not $ghPath) {
    Write-Host "gh.exe non trouve - upload manuel requis" -ForegroundColor Red
    exit 1
  }

  $env:GH_TOKEN = "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"

  & $ghPath release create "v$version" $zipName `
    --title "NUXEN v$version" `
    --notes "Mise a jour automatique v$version" `
    --latest `
    --repo keransrk/nuxen

  Write-Host "Release v$version publiee sur GitHub" -ForegroundColor Green
}
