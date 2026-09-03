@echo off
setlocal
cd /d "%~dp0\.."
set REPO=crey-09/Nicks-Class-Planner
set BRANCH=main
echo.
echo  Nick Manager - update
echo  =====================
echo.
echo  [1/4] Stopping the running app...
call scripts\stop-windows.cmd >nul 2>nul
echo.
echo  [2/4] Getting the latest version...
if not exist .git goto :zip
where git >nul 2>nul
if errorlevel 1 goto :zip
git pull --ff-only
if errorlevel 1 goto :fail
goto :build

:zip
echo  Downloading from GitHub...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri 'https://github.com/%REPO%/archive/refs/heads/%BRANCH%.zip' -OutFile 'update.zip'; if (Test-Path update_tmp) { Remove-Item update_tmp -Recurse -Force }; Expand-Archive -Force update.zip update_tmp"
if errorlevel 1 goto :fail
for /d %%d in (update_tmp\*) do set SRC=%%d
robocopy "%SRC%" . /E /XD data node_modules .git dist /NFL /NDL /NJH /NJS >nul
if errorlevel 8 goto :fail
rmdir /s /q update_tmp
del /q update.zip
powershell -NoProfile -ExecutionPolicy Bypass -Command "(Invoke-RestMethod 'https://api.github.com/repos/%REPO%/commits/%BRANCH%').sha" > VERSION
goto :build

:build
echo.
echo  [3/4] Installing and building...
call npm install
if errorlevel 1 goto :fail
call npx playwright install chromium
call npm run build
if errorlevel 1 goto :fail
echo.
echo  [4/4] Starting...
wscript.exe "%CD%\scripts\start-hidden.vbs"
timeout /t 4 >nul
start "" http://127.0.0.1:3000
echo.
echo  Updated. Nick Manager is running again at http://127.0.0.1:3000
timeout /t 5 >nul
exit /b 0

:fail
echo.
echo  Update failed. Scroll up for the error. Your data is untouched.
echo  You can start the old version again with scripts\start.cmd
pause
exit /b 1
