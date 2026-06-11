# AI Usage HUD

A macOS desktop widget pinned to the wallpaper layer showing live usage limits
for Claude Code and Codex — session/weekly bars, reset countdowns, today's
token/cost stats, and active-session dots. Tauri 2 + TypeScript.

## Run

- `npm install`
- `npm run tauri dev` — run the widget
- `npm run tauri build` — produce the .app bundle
- `npm test` — unit tests
- `npm run probe` — print all provider data in the terminal (no UI)

First run pops one macOS Keychain prompt for "Claude Code-credentials" —
click **Always Allow**.

## Controls

Everything is in the menu bar tray icon: Arrange (drag to move), Float on top,
Refresh now, Launch at login, Quit. The widget is click-through while pinned.

## How it reads your data

- Claude Code: OAuth token from your Keychain → `api.anthropic.com/api/oauth/usage`
  (the same numbers as `/usage`). Today's stats parsed from `~/.claude/projects` logs.
- Codex: token from `~/.codex/auth.json` → `chatgpt.com/backend-api/wham/usage`
  (the same numbers as `/status`). Fallback: session logs. Today's stats from session logs.
- Tokens are read-only and never refreshed, stored, or sent anywhere else.
  Network egress is allowlisted to those two hosts. No telemetry.
- Both endpoints are undocumented — expect occasional breakage when they change.

## Known macOS quirks

- "Click wallpaper to reveal desktop" (Sonoma+, System Settings → Desktop & Dock)
  sweeps app windows aside when you click the widget's area. The widget stays put.
- Adding a provider: one folder under `src/providers/` + one line in `registry.ts`.
