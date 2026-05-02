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

# Compression UPX
$upxPath = $null
$upxSearch = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Recurse -Filter "upx.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($upxSearch) { $upxPath = $upxSearch.FullName }
if (-not $upxPath) {
  $upxCmd = Get-Command upx -ErrorAction SilentlyContinue
  if ($upxCmd) { $upxPath = $upxCmd.Source }
}

if ($upxPath) {
  Start-Sleep -Seconds 2
  $sizeBefore = [math]::Round((Get-Item $exeName).Length / 1MB, 1)
  Write-Host "Compression UPX ($sizeBefore MB)..." -ForegroundColor Yellow
  & $upxPath --best $exeName
  $sizeAfter = [math]::Round((Get-Item $exeName).Length / 1MB, 1)
  Write-Host "Compresse : $sizeBefore MB -> $sizeAfter MB" -ForegroundColor Green
} else {
  Write-Host "UPX non trouve - exe non compresse" -ForegroundColor Yellow
}

# ─── Creer le zip de distribution ────────────────────────────────────────────
Write-Host "Creation du zip de distribution $zipName..." -ForegroundColor Yellow

$tempDist = "dist_temp_$version"
if (Test-Path $tempDist) { Remove-Item -Recurse -Force $tempDist }
New-Item -ItemType Directory -Force -Path "$tempDist\config" | Out-Null

# Copier l'exe
Copy-Item $exeName "$tempDist\$exeName"

# Creer les fichiers config templates
$configCsv = "key,value`ncapsolver_api_key,CAP-XXXXX_REMPLACER_PAR_VOTRE_CLE`ndiscord_webhook_url,https://discord.com/api/webhooks/REMPLACER`ndiscord_user_id_to_ping,`nqty_min,1`nqty_max,2`npoll_status_max_minutes,30`nrequest_delay_ms,3000`n"
$proxiesCsv = "# Un proxy par ligne (format: http://user:pass@host:port)`n# Exemple PacketStream (remplace session et identifiants):`nhttp://10028496:HTC0V7oRwHA67_country-FRANCE_session-11111111@proxy-eu.packetstream.vip:31112`nhttp://10028496:HTC0V7oRwHA67_country-FRANCE_session-22222222@proxy-eu.packetstream.vip:31112`n"

[System.IO.File]::WriteAllText("$tempDist\config\config.csv", $configCsv)
[System.IO.File]::WriteAllText("$tempDist\config\proxies.csv", $proxiesCsv)

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
