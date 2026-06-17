#!/bin/bash
# Launch Claude Spark. Idempotent: if the server is already up, do nothing.
# Ensures dependencies are installed, then starts Electron detached.

set -e
APP_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$APP_DIR"

# Make mise-managed node/npm available when launched from launchd (minimal PATH).
export PATH="$HOME/.local/share/mise/shims:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

# Already running?
if curl -s --max-time 1 http://127.0.0.1:47615/health >/dev/null 2>&1; then
  echo "[claude-spark] already running."
  exit 0
fi

# Install deps on first run.
if [ ! -d "node_modules/electron" ]; then
  echo "[claude-spark] installing dependencies…"
  npm install
fi

echo "[claude-spark] starting…"
# Detach so the launcher returns immediately.
nohup npm start >/tmp/claude-spark.log 2>&1 &
echo "[claude-spark] started (logs: /tmp/claude-spark.log)."
