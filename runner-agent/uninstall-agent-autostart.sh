#!/usr/bin/env bash
# uninstall-agent-autostart.sh — removes the macOS LaunchAgent and stops the
# agent. Run with:  bash uninstall-agent-autostart.sh
set -uo pipefail

LABEL="com.hoichoi.testflow.agent"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
RUNNER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$PLIST"
# KeepAlive would otherwise relaunch it, but bootout already unloaded the job,
# so this just cleans up any lingering process.
pkill -f "$RUNNER_DIR/agent.js" 2>/dev/null || true

echo "Removed LaunchAgent '$LABEL' and stopped the agent."
