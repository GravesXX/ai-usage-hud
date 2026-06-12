#!/bin/zsh
# Stop and remove the headless widget auto-refresh LaunchAgent.
PLIST="$HOME/Library/LaunchAgents/com.moomoo.aiusagehud.refresh.plist"
LABEL="com.moomoo.aiusagehud.refresh"
UID_NUM="$(id -u)"

launchctl bootout "gui/${UID_NUM}/${LABEL}" 2>/dev/null || true
rm -f "$PLIST"
rm -f "$HOME/Library/Application Support/ai-usage-hud/refresh.mjs"
echo "uninstalled. The widget will keep showing its last snapshot until you"
echo "re-install (scripts/install-widget-refresh.sh) or run the app again."
