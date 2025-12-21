@echo off
echo =======================================
echo   Slide Patcher Startup Script
echo =======================================
echo.

if not exist node_modules (
    echo [INFO] node_modules not found. Running npm install...
    call npm install
)

echo [INFO] Starting development server and opening browser...
echo.
call npm run dev -- --open

pause
