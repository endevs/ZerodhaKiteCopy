# Build and push ZerodhaKite images to Docker Hub.
# Prerequisite: docker login  (once)
#
# Usage:
#   $env:DOCKERHUB_NAMESPACE = "yourdockerhubuser"
#   $env:IMAGE_TAG = "1.0.0"   # optional, default latest
#   .\scripts\docker-hub-push.ps1

$ErrorActionPreference = "Stop"
$ns = $env:DOCKERHUB_NAMESPACE
if (-not $ns) {
    $ns = "baparaj"
    Write-Host "DOCKERHUB_NAMESPACE not set; using default $ns (toolsDRP). Set env DOCKERHUB_NAMESPACE to override." -ForegroundColor Yellow
}
$tag = if ($env:IMAGE_TAG) { $env:IMAGE_TAG } else { "latest" }

$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
Write-Host "Building from: $root"
Write-Host "Namespace: $ns  Tag: $tag"
Write-Host "Platforms: linux/amd64,linux/arm64 (Hub + Graviton/ARM64 EC2)"

$platforms = "linux/amd64,linux/arm64"
docker buildx version | Out-Null
if ($LASTEXITCODE -ne 0) { throw "docker buildx required (Docker Desktop or buildx plugin)" }

$builder = "zerodhakite-multi"
$prevEa = $ErrorActionPreference
$ErrorActionPreference = "SilentlyContinue"
docker buildx use $builder 2>&1 | Out-Null
$useExit = $LASTEXITCODE
$ErrorActionPreference = $prevEa
if ($useExit -ne 0) {
    docker buildx create --name $builder --driver docker-container --bootstrap --use
}
docker buildx inspect --bootstrap | Out-Null

docker buildx build --platform $platforms --push `
    -t "${ns}/zerodhakite-backend:${tag}" ./backend
docker buildx build --platform $platforms --push `
    -t "${ns}/zerodhakite-frontend:${tag}" ./frontend

Write-Host "Done. On server run deploy script with same DOCKERHUB_NAMESPACE and IMAGE_TAG."
