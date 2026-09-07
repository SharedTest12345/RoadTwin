@echo off
REM Double-click to start RoadTwin backend + frontend. No Claude Code needed.
setlocal
cd /d "%~dp0"

if not exist "backend\.venv\Scripts\python.exe" (
    echo [setup] Creating backend venv...
    py -3.13 -m venv backend\.venv 2>nul || py -3.12 -m venv backend\.venv 2>nul || py -m venv backend\.venv
    backend\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
)

if not exist "frontend\node_modules" (
    echo [setup] Installing frontend dependencies...
    call npm --prefix frontend install
)

echo [run] Starting backend on http://127.0.0.1:8000 ...
start "RoadTwin Backend" cmd /k backend\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000

echo [run] Starting frontend on http://localhost:5173 ...
start "RoadTwin Frontend" cmd /k npm --prefix frontend run dev

timeout /t 4 /nobreak >nul
start "" "http://localhost:5173"

echo Both servers are starting in their own windows. Close those windows to stop them.
endlocal
