@echo off
rem Double-click to run 90:00 Archive on this computer at http://localhost:3000
cd /d "%~dp0"
if not exist node_modules (
  echo Installing packages the first time...
  call npm install
)
echo Starting the store. Close this window to stop it.
start "" "http://localhost:3000/admin"
call npm run dev
pause
