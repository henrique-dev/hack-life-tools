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

# Electron's binary is fetched by a postinstall script that npm sometimes
# skips (flaky network, interrupted install). Without it the app fails with
# "Error: Electron uninstall", so make sure it is actually there.
if [ ! -d node_modules/electron/dist ]; then
  echo "Electron binary missing, downloading it..."
  node node_modules/electron/install.js
fi

if [ "$1" = "dev" ]; then
  exec npm run dev
else
  exec npm start
fi
