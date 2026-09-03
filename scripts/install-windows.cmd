@echo off
setlocal
cd /d "%~dp0\.."
echo.
echo  Nick Manager - Windows setup
echo  ============================
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo  Node.js is not installed. Get the LTS version from https://nodejs.org , install it, then run this again.
  pause
  exit /b 1
)
for /f "tokens=*" %%v in ('node --version') do echo  Node %%v found.
echo.
echo  [1/4] Installing dependencies...
call npm install
if errorlevel 1 goto :fail
echo.
echo  [2/4] Installing the browser used for Brightspace / Gradescope logins...
call npx playwright install chromium
if errorlevel 1 goto :fail
echo.
echo  [3/4] Building...
call npm run build
if errorlevel 1 goto :fail
echo.
echo  [4/4] Registering auto-start at login...
schtasks /Create /F /SC ONLOGON /TN "Nick Manager" /TR "wscript.exe \"%CD%\scripts\start-hidden.vbs\"" /RL LIMITED >nul
if errorlevel 1 (
  echo  Could not register auto-start. You can start it any time with scripts\start.cmd
) else (
  echo  Nick Manager will start automatically when you log in.
)
echo.
echo  Starting now...
wscript.exe "%CD%\scripts\start-hidden.vbs"
timeout /t 4 >nul
start "" http://127.0.0.1:3000
echo.
echo  Done. Nick Manager runs at http://127.0.0.1:3000
echo  Bookmark that address. Everything stays on this computer.
pause
exit /b 0

:fail
echo.
echo  Something failed. Scroll up for the error, then ask for help.
pause
exit /b 1
