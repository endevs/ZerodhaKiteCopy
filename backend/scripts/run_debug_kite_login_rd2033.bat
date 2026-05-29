@echo off
setlocal
cd /d "%~dp0.."
title RD2033 Headed Kite Login Debug
set KITE_AUTOMATION_HEADED=1
set PYTHONUNBUFFERED=1

set "PY_EXE=%CD%\..\.venv\Scripts\python.exe"
if not exist "%PY_EXE%" set "PY_EXE=python"

echo Using: %PY_EXE%
echo.
"%PY_EXE%" "%CD%\scripts\debug_kite_login_rd2033.py"
echo.
pause
