# AI Usage HUD — Design Spec

**Date:** 2026-06-10
**Status:** Approved (all four sections approved by user)
**Working name:** AI Usage HUD (`ai-usage-hud`) — user may rename later; rename is cosmetic and does not affect this spec.

## Overview

A macOS desktop widget that displays real-time usage limits for AI coding tools — Claude Code and Codex CLI first — pinned to the desktop (wallpaper) layer like a native widget, but updating live. Built as an extensible platform: each tool is a TypeScript "provider" behind one shared interface, so future tools (Cursor/Copilot next in line) can be added without touching the core.

### Goals

- Glanceable, always-present display of session/weekly rate limits with reset countdowns — the same numbers as Claude Code's `/usage` and Codex's `/status`.
- Today's token usage and approximate cost per tool, computed from local logs.
- Active-session indicator (is Claude Code / Codex running right now, and on which model).
- Purely passive: no notifications, no sounds. Color shifts (Claude Code's own convention) carry the warning signal.
- Extensible provider interface that tolerates partially-available tools.

### Non-goals (v1)

- Burn-rate forecasting (explicitly deselected by user).
- Notifications/alerts of any kind (user: "I just want to see it").
- Windows/Linux support.
- Gemini CLI, Cursor, Copilot, API credit balances (future providers; interface must accommodate them, implementations out of scope).
- Historical charts/analytics.
- Refreshing OAuth tokens (see Security — hard constraint, not a deferred feature).

## Requirements (from user Q&A)

| Decision | Choice |
|---|---|
| Surface | Desktop-pinned panel (custom window on the wallpaper layer), toggleable to always-on-top float |
| Content | Rate-limit bars + reset timers; today's token/cost stats; active-session indicator |
| Data source | Hybrid: official endpoints via existing CLI tokens, falling back to local logs/cache |
| Extensibility | Cursor/Copilot likely next; design for partially-available providers |
| Alerts | None. Visual color convention matching Claude Code |
| Stack | Tauri 2 + TypeScript (approved over native Swift and Übersicht) |

## Section 1 — Architecture

A single Tauri 2 app at `~/Desktop/ai-usage-hud`. Responsibilities are deliberately lopsided:

### TypeScript side (React + Vite) — ~95% of the code

Runs in the webview. Owns: provider implementations, polling scheduler, normalization, snapshot cache, all UI. Providers are plain TS modules — no Rust knowledge needed to add one.

### Rust side — thin native shim

Four Tauri commands, each small and single-purpose:

1. `read_keychain(service, account) -> String` — invokes `/usr/bin/security find-generic-password -s <service> -a <account> -w`. Read-only.
2. `read_text_file(path) -> String` / glob listing for paths outside the webview sandbox (`~/.codex/**`, `~/.claude/**`). Read-only; scoped to an allowlist of these two roots.
3. `http_fetch(req) -> resp` — proxies HTTPS requests (webview fetch is CORS-blocked for these hosts). Allowlisted hosts only: `api.anthropic.com`, `chatgpt.com`.
4. `check_processes(patterns) -> matches` — wraps `pgrep` for active-session detection.

Plus the **window-pinning glue** (~40 lines, vendored objc2, detailed in Section 3) and tray setup.

### Tray menu (control surface)

Desktop-layer windows do not receive mouse input (macOS behavior, by design — see Section 3). All interaction happens through a menu bar tray icon:

- **Arrange** — temporarily raises window to normal level so it can be dragged; clicking Arrange again (or auto after drop) re-pins and saves position.
- **Float on top** — toggles `NSWindow.level` between desktop level and floating level (the user's original 悬浮窗 mode).
- **Refresh now** — forces an immediate poll of all providers.
- **Launch at login** — checkbox toggle (autostart, on by default).
- **Quit.**

### Repo layout

```
ai-usage-hud/
├── src/                      # TS frontend
│   ├── providers/            # the platform
│   │   ├── types.ts          # UsageProvider + normalized model
│   │   ├── claude-code/
│   │   └── codex/
│   ├── core/                 # scheduler, cache, state store
│   ├── ui/                   # components, theme
│   └── probe.ts              # CLI smoke test entry
├── src-tauri/                # Rust shim
│   ├── src/commands.rs
│   ├── src/desktop_pin.rs    # objc2 glue
│   └── src/tray.rs
├── fixtures/                 # recorded API/log JSON for tests
└── docs/superpowers/specs/
```

## Section 2 — Data layer (the platform)

### Provider interface

```ts
interface UsageProvider {
  id: string;                       // 'claude-code' | 'codex' | ...
  displayName: string;
  isConfigured(): Promise<boolean>; // creds/logs found?
  fetchLimits(): Promise<LimitWindow[]>;   // official rate-limit windows
  fetchTodayStats(): Promise<TodayStats>;  // tokens/cost from local logs
  checkActiveSession(): Promise<ActiveSession>;
}

interface LimitWindow {
  id: string;            // 'session' | 'weekly' | 'weekly-opus' | ...
  label: string;         // display label, e.g. "Session", "Weekly"
  usedPercent: number;   // 0–100, clamped
  resetsAt?: string;     // ISO timestamp; UI renders countdown
}

interface TodayStats {
  tokens: number;                       // total today (local midnight boundary)
  costUSD?: number;                     // approximate, from bundled pricing table
  byModel?: Record<string, number>;     // tokens per model
}

interface ActiveSession {
  active: boolean;
  model?: string;        // best-effort, from newest local log
}

type ProviderState = 'ok' | 'stale' | 'unconfigured' | 'error';
```

The three fetch methods are independent so a provider can be *partially* available (e.g. a future Cursor provider may support only `fetchTodayStats`). The core renders whatever subset a provider returns; missing capabilities simply don't render rather than erroring.

### Claude Code provider

**Limits (API-first):**
1. Credential lookup, in order: Keychain service `Claude Code-credentials` (account = macOS username) → hashed variants `Claude Code-credentials-<HASH>` (Claude Code v2.1.52+; discover via `security dump-keychain` name scan) → file `~/.claude/.credentials.json`.
2. Credential JSON shape: `{"claudeAiOauth": {accessToken, refreshToken, expiresAt /* epoch ms */, scopes[], rateLimitTier, subscriptionType}}`. If `expiresAt` is past: do **not** refresh (Security section); mark provider `stale`, surface "re-auth in Claude Code" badge, serve cached snapshot.
3. `GET https://api.anthropic.com/api/oauth/usage` with headers: `Authorization: Bearer <accessToken>`, `anthropic-beta: oauth-2025-04-20`, `Accept/Content-Type: application/json`, `User-Agent: claude-code/<version>` (read installed CLI version from `claude --version` at startup, cache it; fall back to a bundled known-good version string).
4. Response → windows: `five_hour` → `session`, `seven_day` → `weekly`, `seven_day_opus` → `weekly-opus` (rendered only if present and non-zero). Each is `{utilization, resets_at}`; `utilization` may arrive as int/float/string — parse defensively; `resets_at` is ISO-8601 with or without fractional seconds.
5. Known risk: this endpoint is undocumented and reported disabled for some accounts. If it returns 404/403/consistent failures, the provider degrades to cached values + `stale` state. **Explicitly rejected fallback:** the `/v1/messages` 1-token probe technique (reads rate-limit headers off a real request) — it spends real quota every poll.

**Today's stats (local):** parse `~/.claude/projects/**/*.jsonl` entries with today's date (local midnight boundary), dedupe by `message.id` + `requestId` (the ccusage approach), sum tokens by model, cost from a bundled static pricing table (marked ≈ in UI). Only files with mtime ≥ today are read, keeping the scan cheap.

**Active session:** `pgrep -x claude`. Model: from the newest project JSONL modified in the last 5 minutes, read the last assistant message's `model` field; omit if not cheaply available.

### Codex provider

**Limits (API-first):**
1. Read `~/.codex/auth.json`: `{auth_mode, OPENAI_API_KEY, tokens: {id_token, access_token, refresh_token, account_id}, last_refresh}`. Read-only; never refresh.
2. `GET https://chatgpt.com/backend-api/wham/usage` with `Authorization: Bearer <access_token>` and `ChatGPT-Account-Id: <account_id>`.
3. Response → windows: `rate_limit.primary_window` → `session` (5h; `limit_window_seconds` 18000 confirms), `rate_limit.secondary_window` → `weekly` (604800). Fields: `{used_percent, reset_at, limit_window_seconds}`. `plan_type` shown as a small caption.
4. Fallback chain when the endpoint fails: newest non-null `rate_limits` from `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` `token_count` events → disk cache. The JSONL snapshot shape differs (`{primary, secondary}` with `used_percent`, `window_minutes`, and `resets_at` *or* legacy `resets_in_seconds`); the websocket event shape in `logs_2.sqlite` differs again (`reset_after_seconds` + `reset_at`). **One shape-tolerant normalizer handles all three shapes** → `LimitWindow`; v1 wires only the REST and JSONL *readers* (the sqlite reader is out of scope — JSONL + cache suffice), but the normalizer accepts the websocket shape too so the sqlite reader is a drop-in later. (Note: on this machine all session JSONLs have `rate_limits: null` because sessions ran through Codex Desktop's websocket transport — which is exactly why the API path is primary.)

**Today's stats (local):** for each session file under today's `~/.codex/sessions/YYYY/MM/DD/`, take the **max** cumulative `total_token_usage.total_tokens` per session and sum across sessions. Using the cumulative max per session avoids the known 91× overcount bug that hits naive event-summing parsers when subagent rollouts replay events.

**Active session:** `pgrep -x codex` (CLI) OR `pgrep -f "Codex.app"` (Codex Desktop).

### Scheduler & cache

One core loop with per-source cadences:

| Source | Cadence | Rationale |
|---|---|---|
| `fetchLimits` (network) | 180 s | community-established safe polling for these endpoints |
| `fetchTodayStats` (local files) | 60 s | cheap, no network |
| `checkActiveSession` (pgrep) | 20 s | cheapest; powers the "live" feel |

Every successful limits snapshot is persisted to disk (Tauri app-data dir, JSON). On any failure the UI serves the cached snapshot with an "as of N min ago" staleness badge — the widget never goes blank. Per-provider state machine: `ok → stale → error`, plus `unconfigured` when `isConfigured()` is false (tool not installed/logged in), rendered as a quiet "not set up" card that doesn't nag.

429 responses: honor `Retry-After`; if absent, 5-minute cooldown before the next limits poll for that provider only.

## Section 3 — Window & UI

### Desktop pinning (the core trick)

Tauri 2 exposes no window-level API (`always_on_bottom` sets level −1 — a normal managed window, *not* the desktop layer). The app vendors ~40 lines of objc2 in `desktop_pin.rs`:

1. Get the native handle: `window.ns_window()` (macOS-only API).
2. On the **main thread** (`window.run_on_main_thread` — AppKit requirement): `setLevel: kCGDesktopWindowLevel` (i.e. `CGWindowLevelForKey(.desktopWindow)` — Übersicht's exact value, preferred over the desktop−1 used by tauri-plugin-desktop-underlay).
3. `setCollectionBehavior: CanJoinAllSpaces (1<<0) | Stationary (1<<4) | IgnoresCycle (1<<6)` — survives Mission Control and Show Desktop, appears on every Space, excluded from Cmd-Tab/window cycling.
4. `setIgnoresMouseEvents: YES` while pinned (clicks pass through to the desktop).

"Float on top" toggle: `setLevel: NSFloatingWindowLevel`, re-enable mouse events. "Arrange" mode: `kCGNormalWindowLevel − 1` + mouse events on, for dragging (Übersicht's interaction-mode pattern). Window is borderless, transparent-background, shadowless, created with `focus: false` so it never steals focus.

**Known macOS gotcha (accepted):** Sonoma+ "Click wallpaper to reveal desktop" (default: Always) sweeps app windows aside when the user clicks the widget's area of wallpaper. The widget itself stays put; documented in README with the System Settings toggle for users who find it surprising.

### Visual design

Claude's visual language, per user request:

- Panel: `#262624` at ~85% opacity, 12px radius, `#faf9f5` primary text, `#d97757` (Claude orange) accents and section markers. System font (SF Pro), 11–13px.
- One card per provider: header row (tool name + green pulse dot when `active`, gray when not), one horizontal bar per `LimitWindow` with label + percentage, reset countdown line ("↻ resets in 2h 14m", ticking client-side between polls), footer line "today: 1.2M tokens · ≈$4.30".
- Bar color by utilization, matching Claude Code's own convention: neutral (Claude orange) below 70%, amber ≥ 70%, red ≥ 90%.
- States: `stale` → bars desaturated + "as of N min ago" caption; `unconfigured` → dimmed card, "not set up"; `error` → card shows last cache + a small ⚠ with tooltip-style detail line.
- Layout target ≈ 280 × 360 px for two providers; height grows with provider count.

### Behavior

- Position: draggable in Arrange mode only; persisted (x, y, display) and restored per-display arrangement. Defaults to top-right of the main display.
- Launch at login via `tauri-plugin-autostart`, enabled by default, toggleable in tray.
- No Dock icon (`LSUIElement` / accessory activation policy) — tray + widget only.

## Section 4 — Error handling, security & testing

### Error handling

| Failure | Behavior |
|---|---|
| Token expired | No refresh, ever. `stale` state + "re-auth in Claude Code / Codex" badge + cached values |
| 429 | `Retry-After` honored; default 5-min cooldown (that provider only) |
| Endpoint 4xx/disabled | Cached values + staleness badge; auto-retries at normal cadence |
| Offline | Same cache-first degradation; no error spam |
| Keychain access denied | Provider `unconfigured` with "grant Keychain access" hint; backs off, doesn't re-prompt in a loop |
| Malformed log lines | Skipped per-line, never fail the whole parse |

### Security posture

- **Read-only credentials.** The app never writes Keychain items, never rotates/refreshes tokens (refresh would rotate the CLI's refresh token — documented cause of expired-session loops in the actual CLIs), and holds tokens in memory only — never written to disk, cache, or logs.
- Network egress limited to two allowlisted hosts: `api.anthropic.com`, `chatgpt.com`. No analytics, no telemetry, no third-party servers.
- Filesystem reads limited to `~/.claude/**` and `~/.codex/**` allowlist in the Rust shim.
- First launch triggers one macOS Keychain prompt; "Always Allow" stops repeats. The `security` CLI can truncate payloads > 2KB — parser must tolerate and regex-extract `accessToken` as last resort.
- Both usage endpoints are undocumented. This is a personal-use tool; expect occasional maintenance when they change. The Claude endpoint requires presenting a `claude-code/<version>` User-Agent.

### Testing

- **Vitest + fixtures** (recorded JSON in `fixtures/`) for everything fragile:
  - Codex normalizer across all three rate-limit shapes (REST `wham/usage`, JSONL snapshot incl. legacy `resets_in_seconds`, websocket event shape).
  - Claude `/api/oauth/usage` response parsing (int/float/string utilization, fractional-second timestamps, missing optional windows).
  - Credential JSON parsing (both tools, including truncated-Keychain recovery path).
  - Today's-stats aggregation: dedupe logic, per-session cumulative-max, midnight boundary.
  - Staleness computation and threshold→color mapping.
  - Scheduler backoff behavior (fake timers).
- **`npm run probe`** — runs all providers against the real machine via Node (Keychain via `security`, real files, real endpoints) and prints the normalized snapshot. Smoke-verifies the full data path without launching the UI.
- **Rust shim:** manual verification checklist for window pinning (survives Show Desktop, Mission Control, Space switches; click-through works; Arrange/Float toggles behave). No automated test — not meaningfully automatable.

## Future extensions (context, not commitments)

- **Cursor/Copilot** (user's likely next provider): no friendly local state — expect a cookie-based or manual-config auth strategy. The interface already tolerates this: partial capability + `unconfigured` state are first-class.
- The provider registry is a plain array; adding a provider = one folder + one registry entry.

## Decisions log

| Decision | Alternatives rejected | Why |
|---|---|---|
| Tauri 2 + TS | Native Swift (lean but Swift-only extension story); Übersicht (third-party host, no float toggle); Electron (150–300MB idle) | TS providers match user's existing plugin skillset; ~60–90MB acceptable |
| Desktop layer via vendored objc2 | tauri-plugin-desktop-underlay (uses desktop−1, Windows-first author); tauri-plugin-decorum (u32 level can't express negative desktop level) | 40 lines, exact control, Übersicht-proven values |
| API-first limits | Local-only estimation (ccusage-style) | User chose hybrid; local estimates can't reproduce official utilization % |
| Never refresh tokens | Auto-refresh with public client IDs (CodexBar's approach) | Refresh rotates the CLI's token; documented expired-session-loop bug; read-only is strictly safer |
| No `/v1/messages` probe fallback | Claude-Usage-Tracker's default path | Spends real quota every poll |
| Cumulative-max per session for Codex stats | Event summing | Avoids known 91× overcount bug with subagent rollout replays |
| Tray as control surface | In-widget buttons | Desktop-layer windows can't receive mouse input; click-through is desirable anyway |
