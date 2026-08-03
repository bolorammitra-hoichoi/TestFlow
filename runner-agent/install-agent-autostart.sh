#!/usr/bin/env bash
# install-agent-autostart.sh — installs the TestFlow runner agent as a macOS
# LaunchAgent so it starts at login, runs in the background (no terminal window),
# and is auto-restarted by launchd if it ever crashes.
#
# Why a LaunchAgent (per-user), NOT a LaunchDaemon (system/root at boot): USB/ADB
# device access is tied to your logged-in GUI session — the same reason the
# Windows side uses a logon task, not a session-0 service. A LaunchDaemon would
# run before login, as root, and wouldn't see your phone.
#
# Run once:   bash install-agent-autostart.sh
# Undo with:  bash uninstall-agent-autostart.sh
set -uo pipefail

LABEL="com.hoichoi.testflow.agent"
RUNNER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$RUNNER_DIR/agent.log"
DOMAIN="gui/$(id -u)"

# node must be found now; we bake its absolute path into the plist because
# launchd starts with a minimal PATH and wouldn't find it otherwise.
NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ]; then
  echo "ERROR: node not found on PATH. Install Node 18+ first (e.g. 'brew install node')." >&2
  exit 1
fi

if [ ! -f "$RUNNER_DIR/.env" ]; then
  echo "WARNING: no .env in $RUNNER_DIR — the agent can't log in. Copy .env.example to .env and fill it in first." >&2
fi

# The agent shells out to adb, maestro, and git by name, so launchd's minimal
# PATH must be widened. Start from THIS shell's PATH (which has your nvm/brew/etc)
# and append the usual tool locations as a safety net.
FULL_PATH="$PATH:/opt/homebrew/bin:/usr/local/bin:$HOME/.maestro/bin:$HOME/Library/Android/sdk/platform-tools:/usr/bin:/bin:/usr/sbin:/sbin"

mkdir -p "$HOME/Library/LaunchAgents"

# Replace any already-installed instance and any manually-run agent.
launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
pkill -f "$RUNNER_DIR/agent.js" 2>/dev/null || true

cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>$RUNNER_DIR/agent.js</string>
  </array>
  <key>WorkingDirectory</key><string>$RUNNER_DIR</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$FULL_PATH</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
PLIST_EOF

launchctl bootstrap "$DOMAIN" "$PLIST" 2>/dev/null || true
launchctl kickstart -k "$DOMAIN/$LABEL" 2>/dev/null || true

if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
  echo "Installed and started LaunchAgent '$LABEL'."
  echo "It runs hidden at login and launchd auto-restarts it if it crashes."
  echo "Logs -> $LOG"
  echo "Open the TestFlow site's Run Test page (or hit 'Check for devices') within ~15s to see this machine's device."
else
  echo "ERROR: the LaunchAgent did not load. Check '$LOG' and 'launchctl error \$?'." >&2
  exit 1
fi
