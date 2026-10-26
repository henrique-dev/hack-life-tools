#!/usr/bin/env sh
# Launch Hack Life Tools on macOS and Linux (run.bat does the same on Windows).
#   ./run.sh        build and open the app
#   ./run.sh dev    open the app with hot reload and dev tools
# Installs the dependencies on first run or when package.json changes.

set -e
cd "$(dirname "$0")"
ROOT=$(pwd)

# Set by terminals inside VS Code and other Electron apps; it would make
# Electron run as plain Node.js.
unset ELECTRON_RUN_AS_NODE

if ! command -v npm >/dev/null 2>&1; then
  echo "Node.js was not found. Install it from https://nodejs.org/ and run this script again."
  exit 1
fi

# Register hacklife:// so the Chrome extension (chrome-extension folder) can
# open the app. Done on every run so it follows the folder if it moves. The
# app is then started without a terminal, so the current PATH is saved for it
# to find npm (e.g. when Node.js comes from nvm or Homebrew).
register_linux() {
  command -v xdg-mime >/dev/null 2>&1 || return 0
  apps="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
  mkdir -p "$apps"
  cat > "$apps/hacklife.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Hack Life Tools
Exec=env "PATH=$PATH" sh "$ROOT/run.sh" %u
Terminal=false
NoDisplay=true
MimeType=x-scheme-handler/hacklife;
EOF
  xdg-mime default hacklife.desktop x-scheme-handler/hacklife || true
}

# On macOS only an app bundle can own a URL scheme, so create a minimal one
# that runs this script.
register_macos() {
  app="$HOME/Applications/Hack Life Tools.app"
  mkdir -p "$app/Contents/MacOS"
  cat > "$app/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>com.hacklifetools.launcher</string>
  <key>CFBundleName</key><string>Hack Life Tools</string>
  <key>CFBundleExecutable</key><string>launcher</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSUIElement</key><true/>
  <key>CFBundleURLTypes</key>
  <array>
    <dict>
      <key>CFBundleURLName</key><string>Hack Life Tools</string>
      <key>CFBundleURLSchemes</key><array><string>hacklife</string></array>
    </dict>
  </array>
</dict>
</plist>
EOF
  # Exits right away, so a later click starts it again and reaches the app.
  cat > "$app/Contents/MacOS/launcher" <<EOF
#!/bin/sh
export PATH='$PATH'
nohup sh '$ROOT/run.sh' >/dev/null 2>&1 &
EOF
  chmod +x "$app/Contents/MacOS/launcher"
  /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$app" || true
}

case "$(uname)" in
  Darwin) register_macos ;;
  Linux) register_linux ;;
esac

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
