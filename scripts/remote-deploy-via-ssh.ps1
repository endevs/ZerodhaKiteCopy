# SSH to your server and pull Hub images + restart stack (docker-compose.hub.yml).
#
# Prerequisites on server: Docker + Compose plugin, repo cloned, backend/.env.production filled in,
#   and docker-compose.hub.yml present (git pull).
#
# Usage:
#   $env:DEPLOY_SSH = "ubuntu@ec2-xx-xx-xx-xx.compute.amazonaws.com"
#   $env:DEPLOY_PATH = "/home/ubuntu/apps/zerodhakite"   # optional; default below
#   $env:DEPLOY_SSH_KEY = "D:\keys\Key_DRP_Ubuntu.pem"   # optional; Windows OpenSSH -i
#   $env:DOCKERHUB_NAMESPACE = "baparaj"                 # optional; default baparaj
#   $env:IMAGE_TAG = "latest"                             # optional
#   .\scripts\remote-deploy-via-ssh.ps1

$ErrorActionPreference = "Stop"
$ssh = $env:DEPLOY_SSH
$path = $env:DEPLOY_PATH
$key = $env:DEPLOY_SSH_KEY
$ns = $env:DOCKERHUB_NAMESPACE
if (-not $ns) {
    $ns = "baparaj"
    Write-Host "DOCKERHUB_NAMESPACE not set; using $ns" -ForegroundColor Yellow
}
$tag = if ($env:IMAGE_TAG) { $env:IMAGE_TAG } else { "latest" }

if (-not $ssh) { throw "Set DEPLOY_SSH e.g. ubuntu@your-server-ip" }
if (-not $path) {
    $path = "/home/ubuntu/apps/zerodhakite"
    Write-Host "DEPLOY_PATH not set; using $path" -ForegroundColor Yellow
}

$sshArgs = @()
if ($key) {
    if (-not (Test-Path -LiteralPath $key)) { throw "DEPLOY_SSH_KEY not found: $key" }
    $sshArgs += @("-i", $key)
}

# Use bash -lc '...' (single-quoted script). Windows OpenSSH + PowerShell breaks
# bash -lc "cd '...' && ..." — cd silently fails and commands run in ~.
if ($path -match "'") { throw "DEPLOY_PATH must not contain single quotes." }

$inner = "docker run --rm --privileged tonistiigi/binfmt --install amd64 2>/dev/null || true; cd $path && git pull origin main || true && export DOCKERHUB_NAMESPACE=$ns IMAGE_TAG=$tag && docker compose -f docker-compose.hub.yml pull && docker compose -f docker-compose.hub.yml up -d && docker compose -f docker-compose.hub.yml ps"

Write-Host "SSH: $ssh  Path: $path  Tag: $tag"
& ssh @sshArgs $ssh "bash -lc '$inner'"
