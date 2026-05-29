$ErrorActionPreference = "Stop"
$py = "C:\Users\USER\AppData\Local\Programs\Python\Python312\python.exe"
$log = "D:\WorkSpace\ZerodhaKiteGit\compile_test_output.txt"
Set-Location "D:\WorkSpace\ZerodhaKiteGit"

"" | Set-Content $log
function Log($msg) { Add-Content $log $msg; Write-Host $msg }

Log "=== Python version ==="
& $py --version 2>&1 | ForEach-Object { Log $_ }

if (-not (Test-Path ".venv")) {
  Log "=== Creating venv ==="
  & $py -m venv .venv 2>&1 | ForEach-Object { Log $_ }
}

$venvPy = "D:\WorkSpace\ZerodhaKiteGit\.venv\Scripts\python.exe"
Log "=== pip install ==="
& $venvPy -m pip install -q --upgrade pip 2>&1 | ForEach-Object { Log $_ }
& $venvPy -m pip install -q pyotp 2>&1 | ForEach-Object { Log $_ }

Log "=== compileall ==="
& $venvPy -m compileall backend 2>&1 | ForEach-Object { Log $_ }

Log "=== unittest ==="
$env:PYTHONPATH = "D:\WorkSpace\ZerodhaKiteGit\backend"
& $venvPy -m unittest backend.tests.test_kite_auth_helpers backend.tests.test_auth_orchestrator -v 2>&1 | ForEach-Object { Log $_ }

Log "=== DONE exit=$LASTEXITCODE ==="
