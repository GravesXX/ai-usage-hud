#!/bin/zsh
# Install (or re-install) the headless widget auto-refresh LaunchAgent.
#
# Why a bundle outside ~/Desktop: macOS TCC blocks LaunchAgents from reading
# ~/Desktop, so we esbuild the refresher into one self-contained file under
# ~/Library/Application Support and run node on that. The agent fetches live
# usage and writes the App Group snapshot every 10 minutes, with no window.
#
# Re-run this after changing provider/snapshot code in src/ (it rebuilds the bundle).
set -e

PROJ="$HOME/Desktop/ai-usage-hud"
DEST="$HOME/Library/Application Support/ai-usage-hud"
PLIST="$HOME/Library/LaunchAgents/com.moomoo.aiusagehud.refresh.plist"
LABEL="com.moomoo.aiusagehud.refresh"
NODE="$(command -v node)"
UID_NUM="$(id -u)"

[ -z "$NODE" ] && { echo "node not found on PATH"; exit 1; }
mkdir -p "$DEST"

echo "1/3 bundling refresher -> $DEST/refresh.mjs"
"$PROJ/node_modules/.bin/esbuild" "$PROJ/scripts/spike-write-snapshot.ts" \
  --bundle --platform=node --format=esm --target=node20 \
  --outfile="$DEST/refresh.mjs"

echo "2/3 writing LaunchAgent -> $PLIST"
cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${NODE}</string>
        <string>${DEST}/refresh.mjs</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin</string>
    </dict>
    <key>StartInterval</key>
    <integer>600</integer>
    <key>RunAtLoad</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/ai-usage-refresh.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/ai-usage-refresh.log</string>
</dict>
</plist>
PLISTEOF

echo "3/3 loading + starting agent"
launchctl bootout "gui/${UID_NUM}/${LABEL}" 2>/dev/null || true
launchctl bootstrap "gui/${UID_NUM}" "$PLIST"
launchctl kickstart -k "gui/${UID_NUM}/${LABEL}"

echo "done. Refreshes every 10 min; logs at /tmp/ai-usage-refresh.log"
echo "Uninstall with: scripts/uninstall-widget-refresh.sh"
