@echo off
echo Stopping Nick Manager...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:":3000 .*LISTENING"') do taskkill /PID %%p /F >nul 2>nul
echo Stopped.
