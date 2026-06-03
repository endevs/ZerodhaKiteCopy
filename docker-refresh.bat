@echo off
setlocal EnableExtensions EnableDelayedExpansion
title ZerodhaKite - Docker Refresh

set "REPO_ROOT=%~dp0"
cd /d "%REPO_ROOT%"

set "COMPOSE_FILE=docker-compose.yml"
set "BUILD_OK=0"
set "UP_OK=0"
set "BACKEND_UP=0"
set "FRONTEND_UP=0"
set "HEALTH_OK=0"
set "HEALTH_CODE=---"
set "LOG_WARN=0"
set "ISSUE_COUNT=0"

echo ============================================================
echo   ZerodhaKite - Docker Refresh (rebuild + recreate)
echo ============================================================
echo Repo: %REPO_ROOT%
echo Compose: %COMPOSE_FILE%
echo Data volume ./data is preserved (no docker compose down -v).
echo.

REM --- Prerequisites ---
where docker >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Docker is not installed or not on PATH.
  set /a ISSUE_COUNT+=1
  goto :summary
)

docker compose version >nul 2>&1
if errorlevel 1 (
  echo [ERROR] "docker compose" is not available. Install Docker Desktop and retry.
  set /a ISSUE_COUNT+=1
  goto :summary
)

if not exist "%REPO_ROOT%%COMPOSE_FILE%" (
  echo [ERROR] Missing %COMPOSE_FILE% in repo root.
  set /a ISSUE_COUNT+=1
  goto :summary
)

REM --- Step 1: Build images ---
echo [STEP 1/4] Building backend and frontend images...
echo.
docker compose -f "%COMPOSE_FILE%" build backend frontend
if errorlevel 1 (
  echo.
  echo [ERROR] docker compose build failed.
  set /a ISSUE_COUNT+=1
  goto :summary
)
set "BUILD_OK=1"
echo.
echo [OK] Build completed.
echo.

REM --- Step 2: Recreate containers ---
echo [STEP 2/4] Recreating containers (force-recreate)...
echo.
docker compose -f "%COMPOSE_FILE%" up -d --force-recreate backend frontend
if errorlevel 1 (
  echo.
  echo [ERROR] docker compose up failed.
  set /a ISSUE_COUNT+=1
  goto :summary
)
set "UP_OK=1"
echo.
echo [OK] Containers started.
echo.

REM --- Step 3: Status + health ---
echo [STEP 3/4] Checking container status and API health...
echo.
docker compose -f "%COMPOSE_FILE%" ps
echo.

echo Waiting 5 seconds for backend to boot...
timeout /t 5 /nobreak >nul

for /f "tokens=*" %%S in ('docker compose -f "%COMPOSE_FILE%" ps --status running --services 2^>nul') do (
  if /i "%%S"=="backend" set "BACKEND_UP=1"
  if /i "%%S"=="frontend" set "FRONTEND_UP=1"
)
if "%BACKEND_UP%"=="0" (
  docker ps --filter "name=zerodhakite-backend" --format "{{.Status}}" 2>nul | findstr /i "Up" >nul && set "BACKEND_UP=1"
)
if "%FRONTEND_UP%"=="0" (
  docker ps --filter "name=zerodhakite-frontend" --format "{{.Status}}" 2>nul | findstr /i "Up" >nul && set "FRONTEND_UP=1"
)

if "%BACKEND_UP%"=="0" (
  echo [CONCERN] Backend service is not listed as running.
  set /a ISSUE_COUNT+=1
)
if "%FRONTEND_UP%"=="0" (
  echo [CONCERN] Frontend service is not listed as running.
  set /a ISSUE_COUNT+=1
)

where curl >nul 2>&1
if errorlevel 1 (
  echo [CONCERN] curl not found; skipping http://localhost:8003/api/health check.
  set /a ISSUE_COUNT+=1
) else (
  for /f "delims=" %%H in ('curl -s -o NUL -w "%%{http_code}" --connect-timeout 10 http://localhost:8003/api/health 2^>nul') do set "HEALTH_CODE=%%H"
  echo API health HTTP status: !HEALTH_CODE!
  if "!HEALTH_CODE!"=="200" (
    set "HEALTH_OK=1"
  ) else (
    echo [CONCERN] Expected HTTP 200 from /api/health (got !HEALTH_CODE!).
    set /a ISSUE_COUNT+=1
  )
)
echo.

REM --- Step 4: Recent backend logs ---
echo [STEP 4/4] Recent backend logs (last 20 lines)...
echo ------------------------------------------------------------
docker logs zerodhakite-backend-1 --tail 20 2>nul
if errorlevel 1 (
  echo [CONCERN] Could not read zerodhakite-backend-1 logs (container name may differ).
  docker compose -f "%COMPOSE_FILE%" logs --tail 20 backend 2>nul
  set /a ISSUE_COUNT+=1
) else (
  docker logs zerodhakite-backend-1 --tail 50 2>nul | findstr /i /c:"ERROR" /c:"TokenException" /c:" failed" /c:"CRITICAL" >nul 2>&1
  if not errorlevel 1 (
    echo.
    echo [CONCERN] Recent logs may contain errors (see lines above).
    set "LOG_WARN=1"
    set /a ISSUE_COUNT+=1
  )
)
echo ------------------------------------------------------------
echo.

:summary
echo ============================================================
echo   SUMMARY
echo ============================================================
echo.

if "%BUILD_OK%"=="1" (echo   [OK] Image build) else (echo   [--] Image build FAILED or skipped)
if "%UP_OK%"=="1" (echo   [OK] Container recreate) else (echo   [--] Container recreate FAILED or skipped)
if "%BACKEND_UP%"=="1" (echo   [OK] Backend running) else (echo   [--] Backend not running)
if "%FRONTEND_UP%"=="1" (echo   [OK] Frontend running) else (echo   [--] Frontend not running)
if "%HEALTH_OK%"=="1" (
  echo   [OK] API health check HTTP 200
) else (
  if "!HEALTH_CODE!"=="---" (
    echo   [--] API health check not performed
  ) else (
    echo   [--] API health check HTTP !HEALTH_CODE!
  )
)
if "%LOG_WARN%"=="1" echo   [--] Possible errors in recent backend logs

echo.
if "%BUILD_OK%"=="1" if "%UP_OK%"=="1" if "%BACKEND_UP%"=="1" if "%FRONTEND_UP%"=="1" if "%HEALTH_OK%"=="1" if "%LOG_WARN%"=="0" (
  echo [SUCCESS] Docker refresh completed. Stack should be ready.
  echo.
  echo   UI:  http://localhost:5175
  echo   API: http://localhost:8003
  echo   Health: http://localhost:8003/api/health
) else (
  echo [ISSUES] Docker refresh finished with concerns ^(!ISSUE_COUNT! noted^).
  echo Review the output above before using the app.
  echo.
  echo   UI:  http://localhost:5175
  echo   API: http://localhost:8003
  if not "%BUILD_OK%"=="1" echo   Tip: Ensure Docker Desktop is running, then retry.
  if "%HEALTH_OK%"=="0" if "%UP_OK%"=="1" echo   Tip: Wait a minute and open /api/health again; backend may still be starting.
)

echo.
echo ============================================================
echo Press any key to close this window...
pause >nul
endlocal
