@echo off
REM =======================================================
REM Start ZerodhaKiteGit backend (Flask + Socket.IO server)
REM =======================================================

SETLOCAL

REM Determine repo root (directory of this script)
SET "REPO_ROOT=%~dp0"
PUSHD "%REPO_ROOT%"

REM Update these paths if your virtual environment lives elsewhere
SET "VENV_DIR=D:\WorkSpace\PythonProjectAI\venv"
SET "BACKEND_DIR=%REPO_ROOT%backend"

IF NOT EXIST "%VENV_DIR%\Scripts\activate.bat" (
    ECHO [ERROR] Could not find virtual environment activate script at:
    ECHO         "%VENV_DIR%\Scripts\activate.bat"
    ECHO Edit start_backend.bat and update VENV_DIR to your environment path.
    GOTO :cleanup
)

IF NOT EXIST "%BACKEND_DIR%\app.py" (
    ECHO [ERROR] Could not find backend app at:
    ECHO         "%BACKEND_DIR%\app.py"
    ECHO Make sure start_backend.bat lives in the repository root.
    GOTO :cleanup
)

ECHO Activating virtual environment...
CALL "%VENV_DIR%\Scripts\activate.bat"

ECHO Launching backend...
CD /D "%BACKEND_DIR%"
python app.py

:cleanup
POPD
ENDLOCAL







