@echo off
setlocal
cd /d "%~dp0"

netstat -ano | findstr ":8443" | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 goto open_browser

:ensure_runtime
where node.exe >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js was not found. Install Node.js 20 or newer first.
  echo https://nodejs.org/
  pause
  exit /b 1
)

where npm.cmd >nul 2>&1
if errorlevel 1 (
  echo [ERROR] npm was not found. Reinstall Node.js with npm included.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo [FIRST RUN] Installing project dependencies. Please wait...
  call npm.cmd install
  if errorlevel 1 (
    echo [ERROR] Dependency installation failed. Check the network and npm configuration.
    pause
    exit /b 1
  )
)

echo Starting ScrumFlow AI...
start "ScrumFlow AI Server" /D "%~dp0" cmd.exe /k "npm.cmd run dev"

set /a WAIT_COUNT=0
:wait_server
ping 127.0.0.1 -n 2 >nul
netstat -ano | findstr ":8443" | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 goto open_browser
set /a WAIT_COUNT+=1
if %WAIT_COUNT% LSS 30 goto wait_server

echo [ERROR] The server did not start within 30 seconds.
echo Check the ScrumFlow AI Server window for details.
pause
exit /b 1

:open_browser
if /I "%SCRUMFLOW_NO_BROWSER%"=="1" exit /b 0
start "" "http://localhost:8443/"
exit /b 0
