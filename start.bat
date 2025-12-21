@echo off
echo =======================================
echo   Slide Patcher Startup Script
echo =======================================
echo.

if not exist node_modules (
    echo [INFO] node_modules not found. Running npm install...
    call npm install
)

echo [INFO] Starting development server...
echo.
call npm run dev

pause
