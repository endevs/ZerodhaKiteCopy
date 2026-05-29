@echo off
setlocal
REM RD2033 TOTP verifier — window stays open; refreshes code every second.
cd /d "%~dp0.."
title RD2033 Kite TOTP Verifier
echo Running RD2033 TOTP verifier (live refresh, Ctrl+C to stop)...
echo Working directory: %CD%
echo.

set "PY_EXE=%CD%\..\.venv\Scripts\python.exe"
if exist "%PY_EXE%" goto run

where python >nul 2>&1
if %errorlevel%==0 (
  set "PY_EXE=python"
  goto run
)

echo ERROR: Could not find Python.
echo Expected: %CD%\..\.venv\Scripts\python.exe
echo.
echo From project root run:
echo   python -m venv .venv
echo   .venv\Scripts\pip install pyotp python-dotenv
echo.
pause
exit /b 1

:run
echo Using: %PY_EXE%
echo.
"%PY_EXE%" "%CD%\scripts\verify_kite_totp.py" --rd2033 --watch
echo.
echo Stopped.
pause
