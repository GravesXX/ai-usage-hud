# AI Usage HUD — WidgetKit Hybrid Design Spec

**Date:** 2026-06-11
**Status:** Approved (all four sections approved by user)
**Builds on:** `2026-06-10-ai-usage-hud-design.md` (the live Tauri desktop panel — unchanged by this work)

## Overview

Add a native macOS **WidgetKit** widget (small + medium) that appears in the widget gallery and Notification Center, alongside the existing live Tauri desktop panel. The widget is a *dumb renderer*: the Tauri app (the single fetcher) writes a usage-snapshot JSON into a shared **App Group** container, and the widget reads it on each OS-scheduled refresh.

### Why a separate native widget at all

A WidgetKit widget cannot be "wrapped" from the Tauri app: WidgetKit renders SwiftUI only (no web view), and widget refresh is OS-budgeted (~5–15 min, not live). So this is an additive second surface in Swift, not a port. The live panel remains the real-time primary; the widget is the glanceable gallery/Notification-Center companion.

### Goals

- A macOS widget in **small + medium** sizes, in the Claude palette, showing each tool's session/weekly bars, reset *times* (absolute, since no live tick), and an "updated Nm ago" line.
- Reuse 100% of the existing fetch/normalize logic — the widget never fetches, reads creds, or calls APIs. One source of truth.
- Additive only: the existing Tauri app and its live panel are untouched except for one new snapshot-writer module.
- Personal-use build on a **free Apple ID** (accepting the ~7-day re-sign cycle).

### Non-goals (v1)

- Live/real-time widget updates (impossible under WidgetKit's refresh budget — that's what the live panel is for).
- Large widget size, Lock Screen / iOS widgets, interactive widget buttons (App Intents).
- Distribution / notarization / App Store (free-team, local-machine only).
- The widget fetching its own data (rejected — see Approaches).
- Re-signing the Tauri app, *unless* the write-access spike proves it necessary (contingency, not planned scope).

## Approaches considered

| Approach | What | Verdict |
|---|---|---|
| **A. Snapshot in App Group, widget pulls (chosen)** | Tauri app writes snapshot JSON to the group container each poll; widget reads on its OS timeline | DRY, single source of truth, widget is a thin renderer, no Swift duplication of creds/API |
| B. Widget fetches independently in Swift | Widget extension reads creds + calls APIs itself on each refresh | Rejected: reimplements all credential/API/normalizer logic in Swift; sandboxed widget can't reach `~/.codex/auth.json` or Keychain; second source of truth, drift risk |
| C. Swift container app fetches | The host app fetches periodically, widget reads | Rejected: the container app isn't continuously running; no background fetch. The Tauri app is the always-on fetcher (autostart) |

## Section 1 — Architecture & targets

One Xcode project inside the repo at `~/Desktop/ai-usage-hud/macos-widget/` (version-controlled with the rest). Two targets:

1. **Container app** (`AIUsageWidgetHost`) — a minimal SwiftUI macOS app. Required because a widget extension must be embedded in a host app; launching it once registers the widget in the gallery. Its window shows a one-line explanation + a "the data comes from AI Usage HUD" note. Carries the App Group entitlement. Accessory/regular policy is fine (it's launched rarely).
2. **Widget extension** (`AIUsageWidget`) — the WidgetKit extension: `TimelineProvider`, `TimelineEntry`, small + medium SwiftUI views, App Group entitlement.

Both targets are signed with the user's **free personal team** and share one **App Group** identifier (e.g. `group.com.<user>.aiusagehud` — exact id chosen at Xcode-config time; the running code resolves the container path via `FileManager.default.containerURL(forSecurityApplicationGroupIdentifier:)`).

**Data flow (one-way):**

```
Tauri app (existing fetcher, every 20-180s)
    │  writes
    ▼
~/Library/Group Containers/<group-id>/usage-snapshot.json
    │  reads (every ~10 min, OS-scheduled)
    ▼
Widget extension TimelineProvider → SwiftUI views
```

No cross-process calls, no WidgetKit reload pushes from the Tauri side. The widget pulls on its own OS timeline.

## Section 2 — Snapshot contract & Tauri writer

### The snapshot file

`usage-snapshot.json` in the App Group container. Versioned so the widget can reject incompatible shapes:

```json
{
  "version": 1,
  "updatedAt": 1781186540979,
  "providers": [
    {
      "id": "claude-code",
      "displayName": "Claude Code",
      "state": "ok",
      "caption": "max",
      "windows": [
        { "id": "session", "label": "Session", "usedPercent": 62, "resetsAt": "2026-06-11T01:14:00.000Z" },
        { "id": "weekly",  "label": "Weekly",  "usedPercent": 28, "resetsAt": "2026-06-14T07:00:00.000Z" }
      ],
      "today": { "tokens": 2502413, "costUSD": 6.54 }
    },
    { "id": "codex", "displayName": "Codex", "state": "ok", "caption": "plus", "windows": [ ... ], "today": { "tokens": 0 } }
  ]
}
```

This is a flattened projection of the existing `ProviderView` records in the store (drop the runtime-only `active`/`asOf`/`note` fields the widget doesn't render; keep `state` so the widget can dim a stale/error provider). `updatedAt` drives the widget's "updated Nm ago".

### Tauri-side writer

New module `src/core/snapshot-writer.ts`:

- `buildSnapshot(views: ProviderView[], now: number): UsageSnapshot` — pure function, projects store views → the contract above. Unit-testable with no I/O.
- `writeSnapshot(bridge, snapshot)` — serializes and writes to the group-container path via a new bridge method.

Wiring: the `Scheduler` calls the writer after each successful `pollLimitsOnce` (and on stats updates), so the file tracks the live store. Best-effort: a write failure is swallowed and logged (never disturbs the panel — same discipline as the existing cache write).

**Bridge addition:** `NativeBridge.writeGroupSnapshot(json: string): Promise<void>`. `TauriBridge` writes to the resolved group-container path (see §4 for how the path is configured/discovered); `NodeBridge` writes to a dev stand-in path (so the probe/tests exercise it); `FakeBridge` records it in memory. The group-container absolute path is provided to the Tauri app via a build-time constant / config once the App Group id is fixed in Xcode.

The existing live panel, providers, scheduler error handling, and tests are otherwise untouched — this is purely additive.

## Section 3 — Widget UI (small + medium)

SwiftUI, Claude palette (`#262624` background, `#faf9f5` text, `#d97757` accent), bar colors neutral → amber ≥70% → red ≥90% (matching the panel's `barColor`).

- **Small (square):** title "⚡ AI Usage"; two compact rows (CC / CX) each with a session bar + percentage; one reset time line. Minimal.
- **Medium (2:1):** title + "updated Nm ago"; per-tool labeled session + weekly bars with percentages; reset times. Matches the approved mockup.
- **Reset display:** absolute local time ("↻ 6:14 PM") rather than a live countdown, because the widget can't tick. Computed from `resetsAt` at render time.
- **Staleness:** if `updatedAt` is older than ~30 min, dim and show "updated Nm ago" prominently. Per-provider `state == "stale"/"error"` dims that provider's row. `unconfigured` shows "not set up".
- **Missing/empty snapshot:** graceful placeholder — "Open AI Usage HUD" (the file appears once the Tauri app has run).

Components: `Snapshot` Codable models (mirror the contract), `SnapshotStore` (reads + decodes the file, returns a typed value or a placeholder), `Provider` (the TimelineProvider), `SmallView`, `MediumView`, shared `UsageBar` + theme constants.

### Timeline

`TimelineProvider.getTimeline` reads the current snapshot and returns a single entry with `.after(~10 min)` refresh policy. WidgetKit will honor it within its budget. No attempt to force sub-budget refresh.

## Section 4 — App Group, signing, build & the validated risk

### Setup (user, in Xcode — exact steps in the plan)

1. Add Apple ID in Xcode → Settings → Accounts (creates the personal team + dev cert).
2. Create the project at `macos-widget/` (macOS App), add a Widget Extension target.
3. Enable **App Groups** capability on *both* targets with the same group id; enable automatic signing with the personal team on both.

### The one validated risk: Tauri write access to the group container

The widget (sandboxed) can only read its App Group container, so the snapshot **must** live there. The open question is whether the **non-sandboxed Tauri app** can *write* into `~/Library/Group Containers/<group-id>/`.

- **Expected:** yes. The container directory is owned by the user; a non-sandboxed process running as the same user can write to user-owned paths. The directory is created when the entitled container app first runs — so the build order is: run the container app once, *then* the Tauri app writes.
- **Spike (front-loaded in the plan):** after the container app's first run, have the Tauri app (or a one-off node script via `NodeBridge`) write and read back a test file in the group path. Confirm before building the rest.
- **Fallback if blocked:** sign the Tauri app with the same App Group entitlement + personal team (Tauri supports a custom entitlements plist + `signingIdentity`). Deterministic but adds the 7-day re-sign cycle to the Tauri app too. Only taken if the spike fails.

### Free-team caveat (documented for the user)

Personal-team signatures expire ~7 days; the widget will stop loading/updating until rebuilt in Xcode (Product → Run). This is inherent to free Apple IDs, not a bug. A $99 account removes it. The live Tauri panel is unaffected (it's ad-hoc signed and keeps working).

### Testing

- **Tauri side:** Vitest for `buildSnapshot` (pure projection: ok/stale/unconfigured states, cost presence/absence, window mapping). `FakeBridge.writeGroupSnapshot` asserted in a writer test.
- **Widget side:** a Swift unit test (XCTest) on `SnapshotStore` decoding — feed it a fixture matching the contract (and a malformed one) and assert the typed result / placeholder fallback. This is the cross-language contract guard.
- **Round-trip:** a fixture JSON shared in spirit between both sides; the Tauri `buildSnapshot` output shape is asserted to match the widget's `Snapshot` Codable expectations (documented field-by-field in the plan).
- **Visual:** Xcode SwiftUI previews for small + medium, then real verification in the gallery after install (manual, user-driven — like the panel's pinning checklist).

## Decisions log

| Decision | Alternatives rejected | Why |
|---|---|---|
| Tauri writes snapshot; widget pulls | Widget self-fetches (B); container app fetches (C) | Reuses existing logic; widget can't reach creds/Keychain when sandboxed; container app isn't always-on |
| App Group file handoff | Any non-group shared path | Sandboxed widget can ONLY read its App Group container |
| Project inside repo (`macos-widget/`) | Separate repo | Version-controlled with the snapshot contract it depends on |
| Small + medium | Medium-only; +large | User chose; large adds layout work with little extra value for 2 tools |
| Absolute reset times | Live countdown | Widget can't tick under OS budget; the live panel has the countdown |
| Free-team, accept 7-day re-sign | Require $99 account | User chose free; documented caveat |
| Front-load write-access spike | Assume it works / assume it fails | Cheapest way to resolve the one real uncertainty before building on it |
