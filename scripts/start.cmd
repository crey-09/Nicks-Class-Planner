@echo off
cd /d "%~dp0\.."
if not exist data mkdir data
set NICK_PORT=3000
echo Nick Manager running at http://127.0.0.1:3000  (close this window to stop)
node server\dist\server\src\index.js
