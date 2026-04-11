# Interactive environment setup for ZerodhaKite.
# Creates backend/.env (local) or backend/.env.production (production).
# Existing values are shown as defaults — press Enter to keep them.
#
# Usage:
#   .\scripts\setup-env.ps1              # prompts for environment type
#   .\scripts\setup-env.ps1 -Env local
#   .\scripts\setup-env.ps1 -Env production

param([string]$Env = "")

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent

function Ask {
    param(
        [string]$Label,
        [string]$Default = "",
        [switch]$Secret,
        [switch]$Required
    )
    while ($true) {
        if ($Secret -and $Default) {
            $shown = $Default.Substring(0, [Math]::Min(4, $Default.Length)) + "****"
            $prompt = "${Label} [${shown}]"
        } elseif ($Default) {
            $prompt = "${Label} [${Default}]"
        } else {
            $prompt = $Label
        }
        Write-Host "  ${prompt} : " -NoNewline -ForegroundColor Cyan
        $val = Read-Host
        if (-not $val) { $val = $Default }
        if ($Required -and -not $val) {
            Write-Host "  [required - cannot be empty]" -ForegroundColor Red
            continue
        }
        return $val
    }
}

function GenerateKey {
    $bytes = New-Object byte[] 32
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($bytes)
    return ([System.BitConverter]::ToString($bytes)).Replace("-", "").ToLower()
}

function Get-EnvMap {
    param([string]$Path)
    $map = @{}
    if (Test-Path $Path) {
        foreach ($line in Get-Content $Path) {
            if ($line -match '^[^#=\s]') {
                $idx = $line.IndexOf('=')
                if ($idx -gt 0) {
                    $k = $line.Substring(0, $idx).Trim()
                    $v = $line.Substring($idx + 1).Trim()
                    $map[$k] = $v
                }
            }
        }
    }
    return $map
}

function Coalesce {
    param([string]$a, [string]$b)
    if ($a) { return $a } else { return $b }
}

# ── Environment choice ─────────────────────────────────────────────────────────
$validEnvs = @("local", "production")
if ($validEnvs -notcontains $Env) {
    Write-Host ""
    Write-Host "ZerodhaKite - Environment Setup" -ForegroundColor Green
    Write-Host "Select target environment:"
    Write-Host "  [1] local       -> backend/.env            (local Docker / docker-compose.hub-local.yml)"
    Write-Host "  [2] production  -> backend/.env.production (EC2 / docker-compose.hub.yml)"
    Write-Host ""
    $choice = Read-Host "Enter 1 or 2"
    $Env = if ($choice -eq "2") { "production" } else { "local" }
}

Write-Host ""
Write-Host "Setting up: $Env" -ForegroundColor Green
Write-Host "Press Enter to keep the value shown in [brackets]."
Write-Host ""

# ── Load existing values ───────────────────────────────────────────────────────
if ($Env -eq "local") {
    $outFile = Join-Path $root "backend\.env"
} else {
    $outFile = Join-Path $root "backend\.env.production"
}

$ex = Get-EnvMap $outFile

if ($Env -eq "local") {
    $defBackend     = Coalesce $ex["BACKEND_URL"]          "http://localhost:8003"
    $defFrontend    = Coalesce $ex["FRONTEND_URL"]         "http://localhost:5175"
    $defCors        = Coalesce $ex["CORS_ORIGINS"]         "http://localhost:5175,http://localhost:8003"
    $defRedirectUri = Coalesce $ex["GOOGLE_REDIRECT_URI"]  "http://localhost:8003/api/auth/google/callback"
    $defKiteNote    = "http://localhost:5175/callback (Nginx -> backend) or http://localhost:8003/callback (direct)"
} else {
    $defBackend     = Coalesce $ex["BACKEND_URL"]          "https://drpinfotech.com"
    $defFrontend    = Coalesce $ex["FRONTEND_URL"]         "https://drpinfotech.com"
    $defCors        = Coalesce $ex["CORS_ORIGINS"]         "https://drpinfotech.com"
    $defRedirectUri = Coalesce $ex["GOOGLE_REDIRECT_URI"]  "https://drpinfotech.com/api/auth/google/callback"
    $defKiteNote    = "$defFrontend/callback"
}

$defSecretKey = Coalesce $ex["SECRET_KEY"] (GenerateKey)
$defDbPath    = Coalesce $ex["DATABASE_PATH"] "database.db"
$defDebug     = Coalesce $ex["DEBUG"] "False"

# ── Collect values ─────────────────────────────────────────────────────────────
Write-Host "-- Server -----------------------------------------------" -ForegroundColor Yellow
$backendUrl  = Ask "BACKEND_URL"       $defBackend
$frontendUrl = Ask "FRONTEND_URL"      $defFrontend
$corsOrigins = Ask "CORS_ORIGINS"      $defCors
$debug       = Ask "DEBUG (True/False)" $defDebug

Write-Host ""
Write-Host "-- Google OAuth -----------------------------------------" -ForegroundColor Yellow
Write-Host "  Add this URI in Google Cloud Console -> Authorized redirect URIs:" -ForegroundColor Gray
Write-Host "  -> $defRedirectUri" -ForegroundColor DarkCyan
$googleId     = Ask "GOOGLE_CLIENT_ID"     (Coalesce $ex["GOOGLE_CLIENT_ID"] "")     -Required
$googleSecret = Ask "GOOGLE_CLIENT_SECRET" (Coalesce $ex["GOOGLE_CLIENT_SECRET"] "") -Secret -Required
$googleUri    = Ask "GOOGLE_REDIRECT_URI"  $defRedirectUri

Write-Host ""
Write-Host "-- Zerodha Kite Connect ---------------------------------" -ForegroundColor Yellow
Write-Host "  Redirect URL to register in Kite developer console:" -ForegroundColor Gray
Write-Host "  -> $defKiteNote" -ForegroundColor DarkCyan
$kiteApiKey    = Ask "KITE_API_KEY"    (Coalesce $ex["KITE_API_KEY"] "")
$kiteApiSecret = Ask "KITE_API_SECRET" (Coalesce $ex["KITE_API_SECRET"] "") -Secret

Write-Host ""
Write-Host "-- Security & Database ----------------------------------" -ForegroundColor Yellow
$secretKey = Ask "SECRET_KEY (auto-generated if blank)" $defSecretKey -Secret
if (-not $secretKey) { $secretKey = GenerateKey }
$dbPath = Ask "DATABASE_PATH" $defDbPath

Write-Host ""
Write-Host "-- SMTP (email / OTP) -----------------------------------" -ForegroundColor Yellow
$smtpServer = Ask "SMTP_SERVER"    (Coalesce $ex["SMTP_SERVER"] "smtp.gmail.com")
$smtpUser   = Ask "USERNAME_EMAIL" (Coalesce $ex["USERNAME_EMAIL"] "")
$smtpPass   = Ask "PASSWORD_EMAIL" (Coalesce $ex["PASSWORD_EMAIL"] "") -Secret
$smtpFrom   = Ask "EMAIL_FROM"     (Coalesce $ex["EMAIL_FROM"] $smtpUser)

Write-Host ""
Write-Host "-- Razorpay ---------------------------------------------" -ForegroundColor Yellow
$rzpId      = Ask "RAZORPAY_KEY_ID"        (Coalesce $ex["RAZORPAY_KEY_ID"] "")
$rzpSecret  = Ask "RAZORPAY_KEY_SECRET"    (Coalesce $ex["RAZORPAY_KEY_SECRET"] "") -Secret
$rzpWebhook = Ask "RAZORPAY_WEBHOOK_SECRET" (Coalesce $ex["RAZORPAY_WEBHOOK_SECRET"] "")

Write-Host ""
Write-Host "-- Optional / AI ----------------------------------------" -ForegroundColor Yellow
$groqKey   = Ask "GROQ_API_KEY" (Coalesce $ex["GROQ_API_KEY"] "")
$groqModel = Ask "GROQ_MODEL"   (Coalesce $ex["GROQ_MODEL"] "llama-3.1-8b-instant")
$logLevel  = Ask "LOG_LEVEL"    (Coalesce $ex["LOG_LEVEL"] "INFO")

# ── Write output file ──────────────────────────────────────────────────────────
$ts = Get-Date -Format 'yyyy-MM-dd HH:mm'

$lines = @(
    "# Generated by scripts/setup-env.ps1 -- $ts",
    "# Environment: $Env",
    "# DO NOT commit this file.",
    "",
    "# -- Server ----------------------------------------------------------------",
    "SERVER_HOST=0.0.0.0",
    "SERVER_PORT=8003",
    "DEBUG=$debug",
    "",
    "BACKEND_URL=$backendUrl",
    "FRONTEND_URL=$frontendUrl",
    "CORS_ORIGINS=$corsOrigins",
    "",
    "SECRET_KEY=$secretKey",
    "DATABASE_PATH=$dbPath",
    "",
    "# -- Google OAuth -----------------------------------------------------------",
    "# Authorized redirect URI registered in Google Cloud Console (must match exactly):",
    "#   $googleUri",
    "GOOGLE_CLIENT_ID=$googleId",
    "GOOGLE_CLIENT_SECRET=$googleSecret",
    "GOOGLE_REDIRECT_URI=$googleUri",
    "",
    "# -- Zerodha Kite Connect ---------------------------------------------------",
    "# Kite developer console redirect URL: $defKiteNote",
    "KITE_API_KEY=$kiteApiKey",
    "KITE_API_SECRET=$kiteApiSecret",
    "",
    "# -- SMTP -------------------------------------------------------------------",
    "SMTP_SERVER=$smtpServer",
    "USERNAME_EMAIL=$smtpUser",
    "PASSWORD_EMAIL=$smtpPass",
    "EMAIL_FROM=$smtpFrom",
    "",
    "# -- Razorpay ---------------------------------------------------------------",
    "RAZORPAY_KEY_ID=$rzpId",
    "RAZORPAY_KEY_SECRET=$rzpSecret",
    "RAZORPAY_WEBHOOK_SECRET=$rzpWebhook",
    "",
    "# -- Optional / AI ----------------------------------------------------------",
    "GROQ_API_KEY=$groqKey",
    "GROQ_MODEL=$groqModel",
    "LOG_LEVEL=$logLevel"
)

if (Test-Path $outFile) {
    Write-Host ""
    Write-Host "File already exists: $outFile" -ForegroundColor Yellow
    $confirm = Read-Host "Overwrite? [y/N]"
    if ($confirm -notmatch '^[yY]') {
        Write-Host "Aborted - no changes written." -ForegroundColor Red
        exit 1
    }
}

$lines | Set-Content -Path $outFile -Encoding UTF8
Write-Host ""
Write-Host "Written: $outFile" -ForegroundColor Green

# ── Next steps ─────────────────────────────────────────────────────────────────
Write-Host ""
if ($Env -eq "local") {
    Write-Host "Next steps:" -ForegroundColor Green
    Write-Host "  1. Ensure Google Cloud Console has this under Authorized redirect URIs:"
    Write-Host "     $googleUri" -ForegroundColor Cyan
    Write-Host "  2. Restart local stack to pick up new .env:"
    Write-Host "     docker compose -f docker-compose.hub-local.yml down" -ForegroundColor Cyan
    Write-Host "     docker compose -f docker-compose.hub-local.yml up -d" -ForegroundColor Cyan
    Write-Host "  3. Open: http://localhost:5175"
} else {
    Write-Host "Next steps:" -ForegroundColor Green
    Write-Host "  1. Copy backend/.env.production to EC2:"
    Write-Host "     scp -i `$env:DEPLOY_SSH_KEY backend\.env.production ubuntu@<ec2>:/home/ubuntu/apps/zerodhakite/backend/.env.production" -ForegroundColor Cyan
    Write-Host "  2. Run the deploy script:"
    Write-Host "     .\scripts\remote-deploy-via-ssh.ps1" -ForegroundColor Cyan
    Write-Host "  3. Google Cloud Console Authorized redirect URI must be exactly:"
    Write-Host "     $googleUri" -ForegroundColor Cyan
}
Write-Host ""
