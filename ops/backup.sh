#!/usr/bin/env bash
# Backs up the Taxify database and uploads.
#
# Uploads are the part that cannot be rebuilt: a receipt exists on exactly one
# disk and is gitignored. The database can at least be re-derived from nothing
# in the sense that the app recreates its schema — but not the records in it.
#
#   ./ops/backup.sh              # database + uploads
#   ./ops/backup.sh --db-only    # database only (used before a deploy)
#   ./ops/backup.sh --tag NAME   # label this one, e.g. predeploy-abc1234
#
# BACKUP_DIR   where to write (default /var/backups/taxify)
# BACKUP_REMOTE  optional rsync target for an off-box copy
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

DB_ONLY=0
TAG=""
while [ $# -gt 0 ]; do
  case "$1" in
    --db-only) DB_ONLY=1; shift ;;
    --tag) TAG="-$2"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

# shellcheck disable=SC1091
set -a; . ./server/.env; set +a

: "${DB_NAME:?DB_NAME is not set in server/.env}"
DEST="${BACKUP_DIR:-/var/backups/taxify}"
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$DEST/daily"

# Credentials go in a 0600 file, never on the command line — anyone running
# `ps` on a shared box would otherwise read the database password.
CONF="$(mktemp)"
chmod 600 "$CONF"
trap 'rm -f "$CONF"' EXIT
cat > "$CONF" <<EOF
[client]
user=${DB_USER}
password=${DB_PASSWORD}
host=${DB_HOST:-localhost}
port=${DB_PORT:-3306}
EOF

DUMP_BIN="mysqldump"
command -v mariadb-dump >/dev/null 2>&1 && DUMP_BIN="mariadb-dump"

DUMP="$DEST/daily/db-${STAMP}${TAG}.sql.gz"
echo "==> dumping ${DB_NAME}"
# --single-transaction gives a consistent snapshot without locking; every table
# is InnoDB, so this is safe against a live site.
"$DUMP_BIN" --defaults-extra-file="$CONF" \
  --single-transaction --quick --routines --events \
  --default-character-set=utf8mb4 --no-tablespaces \
  "$DB_NAME" | gzip -9 > "$DUMP"

# Verify rather than assume. A truncated dump that exited 0 is the classic way
# a backup regime turns out to have been worthless all along.
echo "==> verifying"
gzip -t "$DUMP"
if ! gunzip -c "$DUMP" | tail -5 | grep -q 'Dump completed'; then
  echo "FAILED: dump is incomplete — refusing to keep it" >&2
  rm -f "$DUMP"
  exit 1
fi
echo "    $(du -h "$DUMP" | cut -f1)  $DUMP"

if [ "$DB_ONLY" -eq 0 ]; then
  ARCHIVE="$DEST/daily/uploads-${STAMP}${TAG}.tar.gz"
  echo "==> archiving uploads"
  # .cache holds regenerable HEIC and PDF previews and would otherwise
  # dominate the archive.
  tar -czf "$ARCHIVE" -C server --exclude='uploads/.cache' uploads
  echo "    $(du -h "$ARCHIVE" | cut -f1)  $ARCHIVE"
fi

# Weekly and monthly copies are hardlinks, so a full rotation costs no extra
# disk beyond the first write.
if [ "$(date +%u)" = "7" ]; then
  mkdir -p "$DEST/weekly"; ln -f "$DEST"/daily/*-"${STAMP}${TAG}".* "$DEST/weekly/" 2>/dev/null || true
fi
if [ "$(date +%d)" = "01" ]; then
  mkdir -p "$DEST/monthly"; ln -f "$DEST"/daily/*-"${STAMP}${TAG}".* "$DEST/monthly/" 2>/dev/null || true
fi

echo "==> pruning"
find "$DEST/daily" -type f -mtime +14 -delete 2>/dev/null || true
find "$DEST/weekly" -type f -mtime +56 -delete 2>/dev/null || true
find "$DEST/monthly" -type f -mtime +400 -delete 2>/dev/null || true

# A backup on the same disk survives a bad migration, not a dead disk. This is
# the line between the two, and it is optional only because it needs somewhere
# to go.
if [ -n "${BACKUP_REMOTE:-}" ]; then
  echo "==> copying off-box"
  rsync -a --delete "$DEST/" "$BACKUP_REMOTE" || echo "    WARNING: off-box copy failed" >&2
fi

echo "==> done"
