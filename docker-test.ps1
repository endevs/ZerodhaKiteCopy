# Rebuild stack and run backend compile + auth unit tests inside Docker.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "Building backend image (Playwright + Chromium)..." -ForegroundColor Cyan
docker compose build backend

Write-Host "Starting backend (if not running)..." -ForegroundColor Cyan
docker compose up -d backend

Write-Host "Compile check..." -ForegroundColor Cyan
docker compose exec -T backend python -m compileall .

Write-Host "Unit tests (kite_auth)..." -ForegroundColor Cyan
docker compose exec -T backend python -m unittest tests.test_kite_auth_helpers tests.test_auth_orchestrator -v

Write-Host "Playwright smoke (import + browser binary)..." -ForegroundColor Cyan
$playwrightSmoke = @"
from playwright.sync_api import sync_playwright
p = sync_playwright().start()
b = p.chromium.launch(
    headless=True,
    args=['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
)
b.close()
p.stop()
print('playwright_ok')
"@
docker compose exec -T backend python -c "$playwrightSmoke"

Write-Host "Done. App UI: http://localhost:5175  |  API: http://localhost:8003" -ForegroundColor Green
