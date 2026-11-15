#!/bin/zsh
set -eu
cd "$(dirname "$0")/app"
if /usr/bin/curl -fsS http://127.0.0.1:4317/api/health >/dev/null 2>&1; then
  /usr/bin/open 'http://127.0.0.1:4317/'
  exit 0
fi
export PATH="/usr/local/bin:/opt/homebrew/bin:$HOME/.local/bin:$PATH"
(sleep 2; /usr/bin/open 'http://127.0.0.1:4317/') &
node --disable-warning=ExperimentalWarning server.mjs
