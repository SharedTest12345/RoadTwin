# RoadTwin launcher.
#
#   .\run.ps1          start both servers (installs dependencies on first run)
#   .\run.ps1 -Stop    stop whatever this script started
#
# Opens two terminal windows so you can read the logs and Ctrl+C either one.

param(
    [switch]$Stop
)

$ErrorActionPreference = "Stop"
$root     = $PSScriptRoot
$backend  = Join-Path $root "backend"
$frontend = Join-Path $root "frontend"
$venvPy   = Join-Path $backend ".venv\Scripts\python.exe"

function Stop-Port($port) {
    $owners = (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue).OwningProcess |
              Sort-Object -Unique
    foreach ($processId in $owners) {
        if ($processId) {
            taskkill /PID $processId /T /F | Out-Null
            Write-Host "stopped process $processId on port $port" -ForegroundColor Yellow
        }
    }
    if (-not $owners) { Write-Host "nothing listening on port $port" -ForegroundColor DarkGray }
}

if ($Stop) {
    Stop-Port 8000
    Stop-Port 5173
    return
}

# --- backend dependencies -------------------------------------------------
if (-not (Test-Path $venvPy)) {
    Write-Host "Creating the backend virtualenv..." -ForegroundColor Cyan
    # pydantic-core has no prebuilt wheel yet for very new Python releases (e.g. 3.14),
    # which forces a source build that fails without a Rust toolchain. Prefer 3.13/3.12.
    $created = $false
    foreach ($v in @("3.13", "3.12")) {
        py "-$v" -m venv (Join-Path $backend ".venv") 2>$null
        if ($LASTEXITCODE -eq 0) { $created = $true; break }
    }
    if (-not $created) {
        python -m venv (Join-Path $backend ".venv")
    }
    & $venvPy -m pip install --disable-pip-version-check -q -r (Join-Path $backend "requirements.txt")
}

# --- frontend dependencies ------------------------------------------------
if (-not (Test-Path (Join-Path $frontend "node_modules"))) {
    Write-Host "Installing frontend packages..." -ForegroundColor Cyan
    Push-Location $frontend
    npm install --no-audit --no-fund
    Pop-Location
}

# --- refuse to double-start ----------------------------------------------
foreach ($port in 8000, 5173) {
    if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
        Write-Host "Port $port is already in use. Run '.\run.ps1 -Stop' first." -ForegroundColor Red
        return
    }
}

Write-Host "Starting the API on http://127.0.0.1:8000 ..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList @(
    "-NoExit", "-Command",
    "Set-Location '$backend'; & '$venvPy' -m uvicorn app.main:app --port 8000 --host 127.0.0.1"
)

Write-Host "Starting the web app on http://localhost:5173 ..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList @(
    "-NoExit", "-Command",
    "Set-Location '$frontend'; npm run dev"
)

Start-Sleep -Seconds 6
Start-Process "http://localhost:5173"

Write-Host ""
Write-Host "RoadTwin is starting. Open http://localhost:5173" -ForegroundColor Green
Write-Host "Use localhost, not 127.0.0.1 - Vite binds the IPv6 loopback." -ForegroundColor DarkGray
Write-Host "Stop everything with:  .\run.ps1 -Stop" -ForegroundColor DarkGray
