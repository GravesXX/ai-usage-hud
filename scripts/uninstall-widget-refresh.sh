#!/bin/zsh
# Stop and remove the headless widget auto-refresh LaunchAgent + its artifacts.
LABEL="com.moomoo.aiusagehud.refresh"
UID_NUM="$(id -u)"
launchctl bootout "gui/${UID_NUM}/${LABEL}" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/${LABEL}.plist"
rm -f "$HOME/Library/Application Support/ai-usage-hud/refresh.mjs" \
      "$HOME/Library/Application Support/ai-usage-hud/widget-sync" \
      "$HOME/Library/Application Support/ai-usage-hud/run-refresh.sh"
echo "uninstalled. The widget keeps its last snapshot until you re-install or run the app."
