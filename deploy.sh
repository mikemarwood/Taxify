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
main() {
  cd "$(dirname "${BASH_SOURCE[0]}")"

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

  echo "==> pm2 restart taxify"
  pm2 restart taxify

  echo "==> done"
  pm2 status taxify
}

main "$@"
