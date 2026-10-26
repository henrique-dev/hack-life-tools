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

rem Register hacklife:// so the Chrome extension (chrome-extension folder) can
rem open the app. Done on every run so it follows the folder if it moves.
reg add "HKCU\Software\Classes\hacklife" /ve /d "URL:Hack Life Tools" /f >nul
reg add "HKCU\Software\Classes\hacklife" /v "URL Protocol" /d "" /f >nul
reg add "HKCU\Software\Classes\hacklife\shell\open\command" /ve /d "\"%~dp0run.bat\" \"%%1\"" /f >nul

set "MARKER=node_modules\.package.json.installed"
fc /b package.json "%MARKER%" >nul 2>&1
if not errorlevel 1 goto :launch

echo Installing dependencies...
call npm install --no-audit --no-fund
if errorlevel 1 goto :fail
copy /y package.json "%MARKER%" >nul

:launch
rem Electron's binary is fetched by a postinstall script that npm sometimes
rem skips (flaky network, interrupted install). Without it the app fails with
rem "Error: Electron uninstall", so make sure it is actually there.
if exist "node_modules\electron\dist\" goto :start
echo Electron binary missing, downloading it...
call node node_modules\electron\install.js
if errorlevel 1 goto :fail

:start
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
