@echo off
rem Launch Hack Life Tools on Windows (run.sh does the same on macOS and Linux).
rem   run.bat        build and open the app
rem   run.bat dev    open the app with hot reload and dev tools
rem Installs the dependencies on first run or when package.json changes.

setlocal
cd /d "%~dp0"

rem Set by terminals inside VS Code and other Electron apps; it would make
rem Electron run as plain Node.js.
set "ELECTRON_RUN_AS_NODE="

where npm >nul 2>&1
if errorlevel 1 goto :no_node

set "MARKER=node_modules\.package.json.installed"
fc /b package.json "%MARKER%" >nul 2>&1
if not errorlevel 1 goto :launch

echo Installing dependencies...
call npm install --no-audit --no-fund
if errorlevel 1 goto :fail
copy /y package.json "%MARKER%" >nul

:launch
if /i "%~1"=="dev" (
  call npm run dev
) else (
  call npm start
)
if errorlevel 1 goto :fail
exit /b 0

:no_node
echo Node.js was not found.
echo Install it from https://nodejs.org/ and run this script again.
pause
exit /b 1

:fail
echo.
echo Something went wrong. See the messages above.
pause
exit /b 1
