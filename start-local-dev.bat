@echo off
setlocal EnableExtensions
title ZerodhaKite - local dev setup and start

set "REPO_ROOT=%~dp0"
cd /d "%REPO_ROOT%"

echo === ZerodhaKite local dev (backend + frontend) ===
echo Repo: %REPO_ROOT%
echo.

where python >nul 2>&1 || (
  echo [ERROR] Python not found on PATH. Install Python 3.12+ and retry.
  pause
  exit /b 1
)
where npm >nul 2>&1 || (
  echo [ERROR] npm not found on PATH. Install Node.js 20+ and retry.
  pause
  exit /b 1
)

REM --- Backend: venv + deps ---
if not exist "%REPO_ROOT%backend\venv\Scripts\python.exe" (
  echo Creating backend virtual environment...
  python -m venv "%REPO_ROOT%backend\venv"
)
call "%REPO_ROOT%backend\venv\Scripts\activate.bat"

echo Installing backend dependencies...
python -m pip install --upgrade pip -q
pip install -r "%REPO_ROOT%backend\requirements.txt"
if errorlevel 1 (
  echo [ERROR] pip install failed.
  pause
  exit /b 1
)

if not exist "%REPO_ROOT%backend\.env" (
  echo Creating backend\.env from env_template.txt...
  copy /Y "%REPO_ROOT%backend\env_template.txt" "%REPO_ROOT%backend\.env" >nul
  echo Edit backend\.env for Google / Kite / Razorpay keys.
)

REM --- Frontend: npm install + build ---
cd /d "%REPO_ROOT%frontend"
if not exist "node_modules" (
  echo Installing frontend dependencies...
  call npm ci
) else (
  echo Frontend node_modules found.
)

echo Building frontend...
call npm run build
if errorlevel 1 (
  echo [WARN] npm run build failed; continuing with npm start anyway.
)

cd /d "%REPO_ROOT%"

REM --- Start both in separate windows ---
echo.
echo Starting backend  - http://localhost:8003  (SERVER_PORT in backend\.env)
echo Starting frontend - http://localhost:3000
echo Kite redirect URL for native dev: http://localhost:8003/callback
echo Google OAuth callback: http://localhost:8003/api/auth/google/callback
echo.

start "ZerodhaKite Backend" cmd /k "cd /d \"%REPO_ROOT%backend\" && call \"%REPO_ROOT%backend\venv\Scripts\activate.bat\" && python app.py"
timeout /t 3 /nobreak >nul
start "ZerodhaKite Frontend" cmd /k "cd /d \"%REPO_ROOT%frontend\" && npm start"

echo Open http://localhost:3000 in your browser.
echo Close the Backend and Frontend console windows to stop the app.
pause
endlocal
