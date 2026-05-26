# Restore data/database.db from a backup file. Stops backend container if running.
# Usage: .\scripts\restore-database.ps1 -BackupPath data\backups\database-20260526-120000.db

param(
    [Parameter(Mandatory = $true)]
    [string]$BackupPath
)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

if (-not (Test-Path -LiteralPath $BackupPath)) {
    throw "Backup not found: $BackupPath"
}

$dataDir = Join-Path $root "data"
$db = Join-Path $dataDir "database.db"
New-Item -ItemType Directory -Force -Path (Join-Path $dataDir "backups") | Out-Null

if (Test-Path -LiteralPath $db) {
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $pre = Join-Path $dataDir "backups\database-before-restore-$stamp.db"
    Write-Host "Saving current DB -> $pre" -ForegroundColor Yellow
    Copy-Item -LiteralPath $db -Destination $pre -Force
}

Write-Host "Stopping backend (if running)..."
docker compose stop backend 2>$null | Out-Null

Write-Host "Restoring $BackupPath -> $db"
Copy-Item -LiteralPath $BackupPath -Destination $db -Force

$len = (Get-Item $db).Length
Write-Host "Restored. Size: $([math]::Round($len / 1MB, 2)) MB" -ForegroundColor Green
Write-Host "Start stack: docker compose up -d"
