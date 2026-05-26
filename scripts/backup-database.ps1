# Copy data/database.db to data/backups/database-YYYYMMDD-HHMMSS.db
# Run from repo root: .\scripts\backup-database.ps1

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$db = Join-Path $root "data\database.db"
$backupDir = Join-Path $root "data\backups"

if (-not (Test-Path -LiteralPath $db)) {
    $legacy = Join-Path $root "backend\database.db"
    if (Test-Path -LiteralPath $legacy) {
        Write-Host "data\database.db missing; backing up backend\database.db instead." -ForegroundColor Yellow
        $db = $legacy
    } else {
        throw "No database found at data\database.db or backend\database.db"
    }
}

New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$dest = Join-Path $backupDir "database-$stamp.db"

Write-Host "Backing up $db"
Write-Host "         -> $dest"
Copy-Item -LiteralPath $db -Destination $dest -Force
$len = (Get-Item $dest).Length
Write-Host "Done. Size: $([math]::Round($len / 1MB, 2)) MB" -ForegroundColor Green
