#!/usr/bin/env bash
# Dev/Mac helper: build once, then run the production server.
cd "$(dirname "$0")/.."
export NICK_PORT=3000
[ -d server/dist ] || npm run build
node server/dist/server/src/index.js
