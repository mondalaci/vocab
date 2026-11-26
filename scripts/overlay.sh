#!/usr/bin/env bash
# Launch the overlay.
#
# Some environments here export ELECTRON_RUN_AS_NODE=1 (it is set in the shell
# and in the pm2 daemon), which turns the Electron binary into plain Node — the
# process starts, logs nothing, and never opens a window. Unset it first.
#
# The main process is bundled (it imports the TypeScript modules in server/), so
# rebuild it when its sources are newer than the bundle. The renderer build in
# dist/ is a separate step: `npm run build`.
set -euo pipefail

cd "$(dirname "$0")/.."
unset ELECTRON_RUN_AS_NODE

stale=1
if [ -f dist-electron/main.mjs ]; then
  if [ -z "$(find electron server shared -type f \( -name '*.ts' -o -name '*.mjs' \) -newer dist-electron/main.mjs -print -quit)" ]; then
    stale=0
  fi
fi
if [ "$stale" = 1 ]; then
  echo "[overlay] rebuilding the main-process bundle"
  npm run build:main --silent
fi

exec ./node_modules/.bin/electron dist-electron/main.mjs "$@"
