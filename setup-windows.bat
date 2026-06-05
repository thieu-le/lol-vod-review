@echo off
REM One-shot Windows setup for LoL VOD Review.
REM Double-click this file, or run it from a terminal in the project folder.

echo.
echo === LoL VOD Review - Windows setup ===
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js is not installed.
  echo         Install Node 18+ from https://nodejs.org then run this again.
  echo.
  pause
  exit /b 1
)

for /f "delims=" %%v in ('node --version') do echo Using Node %%v
echo.

echo Installing dependencies (this also rebuilds native modules for Electron)...
call npm install
if errorlevel 1 (
  echo.
  echo [ERROR] npm install failed.
  echo         If it failed building better-sqlite3, install
  echo         "Desktop development with C++" via the Visual Studio Installer,
  echo         then run:  npm run rebuild
  echo.
  pause
  exit /b 1
)

echo.
echo Running environment check...
echo.
call npm run doctor

echo.
echo === Setup finished ===
echo Next steps:
echo   1. In OBS: Tools - WebSocket Server Settings - Enable (port 4455).
echo   2. Make sure OBS is set to RECORD (not just stream).
echo   3. Start the app:  npm run dev
echo.
pause
