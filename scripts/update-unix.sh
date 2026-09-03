#!/usr/bin/env bash
# Mac/Linux equivalent of update-windows.cmd: pull, rebuild, restart.
set -e
cd "$(dirname "$0")/.."
echo "Stopping..."
lsof -ti tcp:3000 | xargs -r kill 2>/dev/null || true
echo "Updating..."
if [ -d .git ] && command -v git >/dev/null; then
  git pull --ff-only
else
  curl -sL "https://github.com/crey-09/Nicks-Class-Planner/archive/refs/heads/main.zip" -o update.zip
  rm -rf update_tmp && mkdir update_tmp && unzip -q update.zip -d update_tmp
  rsync -a --exclude data --exclude node_modules --exclude .git --exclude dist update_tmp/*/ ./
  rm -rf update_tmp update.zip
  curl -s "https://api.github.com/repos/crey-09/Nicks-Class-Planner/commits/main" | python3 -c "import json,sys; print(json.load(sys.stdin)['sha'])" > VERSION
fi
npm install
npx playwright install chromium
npm run build
echo "Starting..."
NICK_PORT=3000 nohup node server/dist/server/src/index.js >> data/server.log 2>&1 &
sleep 3
open http://127.0.0.1:3000 2>/dev/null || true
echo "Updated."
