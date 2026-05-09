@echo off
if /I not "%~1"=="__run" (
  start "Banner Tool" cmd /k ""%~f0" __run"
  exit /b
)

setlocal EnableExtensions
cd /d "%~dp0"

if not exist "public" mkdir "public"
if not exist "public\data" mkdir "public\data"

set "STARTUP_LOG=public\data\startup-log.txt"
set "BANNER_TOOL_STARTER=start-windows.bat"
set "PATH=%PATH%;%APPDATA%\npm"
if exist "%APPDATA%\npm\codex.cmd" (
  set "CODEX_BIN=%APPDATA%\npm\codex.cmd"
) else (
  set "CODEX_BIN=codex"
)

>> "%STARTUP_LOG%" echo ===== Banner Tool startup %DATE% %TIME% =====
>> "%STARTUP_LOG%" echo cwd=%CD%
>> "%STARTUP_LOG%" echo starter=start-windows.bat
>> "%STARTUP_LOG%" echo os=%OS%
>> "%STARTUP_LOG%" echo computer=%COMPUTERNAME%
>> "%STARTUP_LOG%" echo user=%USERNAME%
>> "%STARTUP_LOG%" echo CODEX_BIN=%CODEX_BIN%

echo ========================================
echo Banner Tool - start
echo ========================================
echo.

echo [1/3] Checking Node.js...
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found.
  echo Install Node.js LTS from https://nodejs.org/ and run this file again.
  >> "%STARTUP_LOG%" echo node=not-found
  start "" "https://nodejs.org/"
  goto end
)
node --version
node --version >> "%STARTUP_LOG%" 2>&1

echo.
echo [2/3] Checking app dependencies...
if exist "node_modules" (
  echo Dependencies: OK
  >> "%STARTUP_LOG%" echo npmInstall=skipped-node_modules-exists
) else (
  echo First setup is running. This can take a few minutes.
  >> "%STARTUP_LOG%" echo npmInstall=start
  call npm install
  if errorlevel 1 (
    echo Setup failed. See public\data\startup-log.txt for details.
    >> "%STARTUP_LOG%" echo npmInstall=failed
    goto end
  )
  >> "%STARTUP_LOG%" echo npmInstall=ok
)

echo.
echo [3/3] Starting app...
echo Opening browser: http://127.0.0.1:3000
start "" "http://127.0.0.1:3000"

echo.
echo Server is running.
echo To stop: press Ctrl + C in this window.
echo.
echo Codex is checked inside the app with the connection test button.
echo.

>> "%STARTUP_LOG%" echo npmRunDev=start
call npm run dev -- --hostname 127.0.0.1 --port 3000
>> "%STARTUP_LOG%" echo npmRunDev=ended errorlevel=%ERRORLEVEL%

:end
echo.
echo Window will stay open so you can read any messages.
pause
exit /b
