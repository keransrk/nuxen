# NUXEN Build Script
# Usage:
#   .\build.ps1              # Build local uniquement
#   .\build.ps1 -release     # Build + cree une GitHub Release (necessite gh CLI)

param(
  [switch]$release
)

$ErrorActionPreference = "Stop"

# Lire la version depuis src/version.ts
$versionLine = Get-Content "src\version.ts" | Where-Object { $_ -match "APP_VERSION" }
$version = ($versionLine -replace ".*'([\d.]+)'.*", '$1').Trim()
if (-not $version) {
  # Fallback: extraire avec regex double quotes
  $version = ($versionLine -replace '.*"([\d.]+)".*', '$1').Trim()
}
$exeName = "Nuxen-$version.exe"
Write-Host "NUXEN v$version -> $exeName" -ForegroundColor Cyan

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

# Compression UPX (reduit ~70% la taille)
$upxPath = $null
$upxSearch = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Recurse -Filter "upx.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($upxSearch) { $upxPath = $upxSearch.FullName }
if (-not $upxPath) {
  $upxCmd = Get-Command upx -ErrorAction SilentlyContinue
  if ($upxCmd) { $upxPath = $upxCmd.Source }
}

if ($upxPath) {
  $sizeBefore = [math]::Round((Get-Item $exeName).Length / 1MB, 1)
  Write-Host "Compression UPX ($sizeBefore MB)..." -ForegroundColor Yellow
  & $upxPath --best $exeName | Out-Null
  $sizeAfter = [math]::Round((Get-Item $exeName).Length / 1MB, 1)
  Write-Host "Compresse : $sizeBefore MB -> $sizeAfter MB" -ForegroundColor Green
} else {
  Write-Host "UPX non trouve - exe non compresse (installe: winget install upx.upx)" -ForegroundColor Yellow
}

# Release GitHub
if ($release) {
  Write-Host ""
  Write-Host "Creation de la GitHub Release v$version..." -ForegroundColor Magenta

  $ghPath = $null
  $ghCmd = Get-Command gh -ErrorAction SilentlyContinue
  if ($ghCmd) { $ghPath = $ghCmd.Source }
  if (-not $ghPath -and (Test-Path ".\gh.exe")) { $ghPath = ".\gh.exe" }

  if (-not $ghPath) {
    Write-Host "GitHub CLI (gh) non installe." -ForegroundColor Red
    exit 1
  }

  $env:GH_TOKEN = "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"

  & $ghPath release create "v$version" $exeName `
    --title "NUXEN v$version" `
    --notes "Mise a jour automatique v$version" `
    --latest `
    --repo keransrk/nuxen

  Write-Host "Release v$version publiee sur GitHub" -ForegroundColor Green
}
