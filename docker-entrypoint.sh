#!/bin/sh
# Railway (like most hosts) mounts volumes owned by root, so the unprivileged `node` user could not write the
# SQLite database there. Take ownership of DATA_DIR as root, then drop privileges for the server itself.
set -e

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  chown -R node:node "$DATA_DIR"
  if command -v setpriv >/dev/null 2>&1; then
    exec setpriv --reuid=node --regid=node --init-groups "$@"
  fi
  echo "[entrypoint] setpriv not found; running as root" >&2
fi

exec "$@"
