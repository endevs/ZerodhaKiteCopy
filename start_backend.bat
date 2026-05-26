@echo off
REM Legacy launcher — prefer start-local-dev.bat for full install + frontend.
set "REPO_ROOT=%~dp0"
set "VENV_DIR=%REPO_ROOT%backend\venv"
set "BACKEND_DIR=%REPO_ROOT%backend"

IF NOT EXIST "%VENV_DIR%\Scripts\activate.bat" (
    ECHO [ERROR] Virtual environment not found. Run start-local-dev.bat once, or:
    ECHO         python -m venv backend\venv
    pause
    exit /b 1
)

CALL "%VENV_DIR%\Scripts\activate.bat"
CD /D "%BACKEND_DIR%"
python app.py
