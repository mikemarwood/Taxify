#!/usr/bin/env bash
# Restores a Taxify backup.
#
#   ./ops/restore.sh /var/backups/taxify/daily/db-20260801-020000.sql.gz \
#                    [/var/backups/taxify/daily/uploads-20260801-020000.tar.gz]
#
# An untested restore is not a backup, so this is meant to be run — at least
# once, into a scratch database, before it is ever needed for real. Point
# DB_NAME at something disposable to rehearse:
#
#   DB_NAME=taxify_restore_test ./ops/restore.sh <dump>
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

DUMP="${1:?usage: restore.sh <db-dump.sql.gz> [uploads.tar.gz]}"
UPLOADS="${2:-}"

# shellcheck disable=SC1091
set -a; . ./server/.env; set +a
: "${DB_NAME:?DB_NAME is not set in server/.env}"

echo "This will REPLACE the contents of database '${DB_NAME}'."
[ -n "$UPLOADS" ] && echo "It will also replace server/uploads."
read -r -p "Type the database name to confirm: " CONFIRM
[ "$CONFIRM" = "$DB_NAME" ] || { echo "Did not match — nothing was changed."; exit 1; }

CONF="$(mktemp)"; chmod 600 "$CONF"; trap 'rm -f "$CONF"' EXIT
cat > "$CONF" <<EOF
[client]
user=${DB_USER}
password=${DB_PASSWORD}
host=${DB_HOST:-localhost}
port=${DB_PORT:-3306}
EOF

CLIENT_BIN="mysql"; command -v mariadb >/dev/null 2>&1 && CLIENT_BIN="mariadb"

# Stopped first: ensureSchema and the data migrations run at boot, and having
# them race a restore is how you end up with half of each.
if command -v pm2 >/dev/null 2>&1; then
  echo "==> stopping taxify"
  pm2 stop taxify || true
fi

echo "==> restoring database"
gunzip -c "$DUMP" | "$CLIENT_BIN" --defaults-extra-file="$CONF" "$DB_NAME"

if [ -n "$UPLOADS" ]; then
  echo "==> restoring uploads"
  # Extracted beside the live tree and swapped, never extracted over it —
  # otherwise a failure halfway leaves a mixture of both.
  rm -rf server/uploads.restoring
  mkdir -p server/uploads.restoring
  tar -xzf "$UPLOADS" -C server/uploads.restoring
  if [ -d server/uploads ]; then mv server/uploads "server/uploads.replaced-$(date +%Y%m%d-%H%M%S)"; fi
  mv server/uploads.restoring/uploads server/uploads
  rmdir server/uploads.restoring
  echo "    previous uploads kept alongside as uploads.replaced-*; delete when satisfied"
fi

if command -v pm2 >/dev/null 2>&1; then
  echo "==> starting taxify"
  pm2 start taxify || pm2 restart taxify
fi

echo "==> done"
