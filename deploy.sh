#!/usr/bin/env bash
# Pulls the latest Taxify code, reinstalls deps only if package.json
# changed, rebuilds the client, and restarts the PM2 process.
set -euo pipefail

# Everything lives in a function called on the very last line, and that is not
# a style choice. Bash reads a script incrementally while running it, tracking
# where it is by byte offset — so `git pull` rewriting this file mid-deploy
# leaves it carrying on at an offset that now points into different text. That
# is exactly what happened when the pre-deploy snapshot was removed: the pull
# brought the new file down, and the old line ran anyway. Wrapping the body in
# a function makes bash parse the whole thing before the first command runs.
# The user whose pm2 owns the taxify process. Every pm2 daemon is per-user and
# sees only its own processes, so running this as anybody else gets all the way
# through install, test and build and then dies on "Process or Namespace taxify
# not found" — with the new front end already built and the old server still
# serving it. Overridable for a host set up differently.
PM2_USER="${TAXIFY_PM2_USER:-mikes1118}"

main() {
  cd "$(dirname "${BASH_SOURCE[0]}")"

  # Checked before anything is installed, built or written, because what it
  # prevents is a half-done deploy. Running as root also leaves node_modules
  # and client/dist owned by root, which is what then breaks the next deploy by
  # the right user — so this refuses rather than warns.
  if [ "$(id -un)" != "$PM2_USER" ]; then
    if [ "${TAXIFY_ALLOW_ANY_USER:-}" = "1" ]; then
      echo "==> running as $(id -un), not $PM2_USER — continuing because TAXIFY_ALLOW_ANY_USER=1"
    else
      echo "This deploy must run as $PM2_USER — pm2 only sees its own user's processes." >&2
      echo "" >&2
      echo "  sudo -iu $PM2_USER -- bash -lc 'cd $(pwd) && ./deploy.sh'" >&2
      echo "" >&2
      echo "If pm2 runs as somebody else here, set TAXIFY_PM2_USER to them." >&2
      echo "To skip this check, set TAXIFY_ALLOW_ANY_USER=1." >&2
      exit 1
    fi
  fi

  echo "==> git pull"
  local before after
  before=$(git rev-parse HEAD:deploy.sh 2>/dev/null || echo none)
  git pull
  after=$(git rev-parse HEAD:deploy.sh 2>/dev/null || echo none)

  # If the pull changed this script, finish the deploy with the new one rather
  # than the version already in memory. The second run's pull is a no-op, so
  # the two hashes match and it cannot loop.
  if [ "$before" != "$after" ]; then
    echo "==> deploy.sh itself changed — restarting with the new version"
    # Through bash explicitly, rather than exec'ing the path.
    #
    # `exec "$0"` asks the kernel to run the file, which needs the execute bit
    # — and this is launched as `bash deploy.sh` from a wrapper, so nothing
    # ever required that bit to be set and it was not. The restart died with
    # "Permission denied" having already pulled, which is the worst place to
    # stop: new code on disk, nothing installed, built or restarted.
    #
    # BASH_SOURCE rather than $0 because it is the script's own path even when
    # the script is sourced or invoked through a wrapper.
    exec "${BASH:-bash}" "${BASH_SOURCE[0]}" "$@"
  fi

  echo "==> npm install (server)"
  npm install --prefix server

  echo "==> npm install (client)"
  npm install --prefix client

  # Tests before the build, not after.
  #
  # The running server serves client/dist, so building first means a failed
  # test leaves the new front end already live against the old back end —
  # the deploy has stopped, but it has stopped half done. Testing first, a
  # failure stops everything with nothing changed.
  #
  # What this is: check-imports catches calling a helper nobody imported (which
  # reached production twice), then the test suite. Neither prints much unless
  # something is wrong, and `set -e` means either one failing stops the deploy
  # before pm2 restarts anything. That is the whole point of them being here —
  # it is the last gate before customers see it.
  echo "==> npm test (server)"
  npm test --prefix server

  echo "==> npm run build (client)"
  npm run build

  # Deploying does not snapshot the database. `ops/backup.sh` is still here and
  # still works if one is ever wanted:
  #
  #   ./ops/backup.sh --db-only
  #
  # What that trades away: `pm2 restart` is when ensureSchema runs its ALTERs
  # and the data migrations rewrite rows — the category split repoints
  # expenses, the currency backfill writes to every one of them, and
  # receiptFolders renames whole upload trees.

  # Started rather than restarted when pm2 has never heard of it — a first
  # deploy, or one after the daemon was wiped. `pm2 restart` on an unknown name
  # is an error, which used to stop the deploy here with everything else done.
  echo "==> pm2 restart taxify"
  if pm2 describe taxify >/dev/null 2>&1; then
    pm2 restart taxify --update-env
  else
    echo "    pm2 does not know taxify yet — starting it from ecosystem.config.cjs"
    pm2 start ecosystem.config.cjs
    pm2 save
  fi

  echo "==> done"
  pm2 status taxify
}

main "$@"
