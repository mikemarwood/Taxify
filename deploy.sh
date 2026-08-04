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

echo "==> npm test (server)"
npm test --prefix server

# Deploying no longer snapshots the database first. `ops/backup.sh` is still
# here and still works — run it by hand if you ever want one:
#
#   ./ops/backup.sh --db-only
#
# Worth knowing what that trades away: `pm2 restart` is exactly when
# ensureSchema runs its ALTERs and the data migrations rewrite rows. The
# category split repoints expenses, the currency backfill writes to every one
# of them, and receiptFolders renames whole upload trees.

echo "==> pm2 restart taxify"
pm2 restart taxify

echo "==> done"
pm2 status taxify
