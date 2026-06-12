#!/bin/zsh
# Install (or re-install) the headless widget auto-refresh LaunchAgent.
#
# Every 10 minutes (and shortly after wake), with no window, it:
#   1. fetches live usage and writes the App Group snapshot (Node bundle), then
#   2. tells WidgetKit to redraw the widget (signed Swift helper).
#
# Why a bundle/binary outside ~/Desktop: macOS TCC blocks LaunchAgents from
# reading ~/Desktop, so the runtime artifacts live under ~/Library/Application Support.
#
# Re-run this after changing provider/snapshot code in src/ (it rebuilds everything).
set -e

PROJ="$HOME/Desktop/ai-usage-hud"
DEST="$HOME/Library/Application Support/ai-usage-hud"
PLIST="$HOME/Library/LaunchAgents/com.moomoo.aiusagehud.refresh.plist"
LABEL="com.moomoo.aiusagehud.refresh"
NODE="$(command -v node)"
UID_NUM="$(id -u)"

[ -z "$NODE" ] && { echo "node not found on PATH"; exit 1; }
mkdir -p "$DEST"

echo "1/5 bundling refresher -> $DEST/refresh.mjs"
"$PROJ/node_modules/.bin/esbuild" "$PROJ/scripts/spike-write-snapshot.ts" \
  --bundle --platform=node --format=esm --target=node20 \
  --outfile="$DEST/refresh.mjs"

echo "2/5 building + signing the WidgetKit reload helper"
IDENTITY="$(security find-identity -v -p codesigning | grep 'Apple Development' | head -1 | sed -E 's/.*"([^"]+)".*/\1/')"
[ -z "$IDENTITY" ] && { echo "no 'Apple Development' signing identity found (open Xcode, sign in, build once)"; exit 1; }
xcrun swiftc "$PROJ/scripts/reload-widget.swift" -o "$DEST/reload-widget"
codesign --force --sign "$IDENTITY" --entitlements "$PROJ/scripts/reload.entitlements" "$DEST/reload-widget"

echo "3/5 writing run wrapper -> $DEST/run-refresh.sh"
cat > "$DEST/run-refresh.sh" <<RUNEOF
#!/bin/zsh
# Refresh data, then push a redraw to the widget.
"$NODE" "$DEST/refresh.mjs"
"$DEST/reload-widget"
RUNEOF
chmod +x "$DEST/run-refresh.sh"

echo "4/5 writing LaunchAgent -> $PLIST"
cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/zsh</string>
        <string>${DEST}/run-refresh.sh</string>
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

echo "5/5 loading + starting agent"
launchctl bootout "gui/${UID_NUM}/${LABEL}" 2>/dev/null || true
launchctl bootstrap "gui/${UID_NUM}" "$PLIST"
launchctl kickstart -k "gui/${UID_NUM}/${LABEL}"

echo "done. Refresh+reload every 10 min; logs at /tmp/ai-usage-refresh.log"
