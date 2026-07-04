#!/usr/bin/env bash
# Pulls the latest Taxify code, reinstalls deps only if package.json
# changed, rebuilds the client, and restarts the PM2 process.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

echo "==> git pull"
git pull

echo "==> npm install (server)"
npm install --prefix server

echo "==> npm install (client)"
npm install --prefix client

echo "==> npm run build (client)"
npm run build

echo "==> pm2 restart taxify"
pm2 restart taxify

echo "==> done"
pm2 status taxify
