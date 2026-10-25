#!/usr/bin/env sh
# Launch Hack Life Tools on macOS and Linux (run.bat does the same on Windows).
#   ./run.sh        build and open the app
#   ./run.sh dev    open the app with hot reload and dev tools
# Installs the dependencies on first run or when package.json changes.

set -e
cd "$(dirname "$0")"

# Set by terminals inside VS Code and other Electron apps; it would make
# Electron run as plain Node.js.
unset ELECTRON_RUN_AS_NODE

if ! command -v npm >/dev/null 2>&1; then
  echo "Node.js was not found. Install it from https://nodejs.org/ and run this script again."
  exit 1
fi

MARKER=node_modules/.package.json.installed
if ! cmp -s package.json "$MARKER"; then
  echo "Installing dependencies..."
  npm install --no-audit --no-fund
  cp package.json "$MARKER"
fi

if [ "$1" = "dev" ]; then
  exec npm run dev
else
  exec npm start
fi
