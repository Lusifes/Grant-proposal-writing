@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
echo ==============================================
echo   ResearchGrant Studio 1.0  -  Quick Start
echo ==============================================
echo.

set NEED_SETUP=0
if not exist "node_modules\express" set NEED_SETUP=1
if not exist "client\node_modules\react" set NEED_SETUP=1

if "!NEED_SETUP!"=="1" (
  echo [1/2] Installing dependencies (first run only, may take a few minutes)...
  call npm run setup
  if errorlevel 1 goto :error
) else (
  echo [1/2] Dependencies already installed.
)

if not exist "client\dist\index.html" (
  echo [2/3] Building frontend...
  call npm run build
  if errorlevel 1 goto :error
)

echo [3/3] Starting server...
echo.
echo   Open http://localhost:4321 in your browser.
echo   Press Ctrl+C to stop.
echo.
call npm start
goto :eof

:error
echo.
echo Startup failed. Check the error messages above.
echo If the npm registry is unreachable, run:
echo   npm config set registry https://registry.npmjs.org
echo and retry.
pause
