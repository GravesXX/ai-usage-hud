# AI Usage — macOS WidgetKit widget

A native macOS widget (small + medium) that renders a usage snapshot the Tauri
app writes into a shared App Group container. The Xcode project lives in
`AIUsageWidgetHost/`.

## Project structure (as wired in Xcode)

- `AIUsageWidgetHost/AIUsageWidgetHost.xcodeproj` — the Xcode project (two targets)
- `AIUsageWidgetHost/AIUsageWidgetHost/` — **host app** target
  - `ContentView.swift` — the launcher window (just explains how to add the widget)
  - `AIUsageWidgetHostApp.swift` — `@main` for the host app
- `AIUsageWidgetHost/AIUsageWidget/` — **widget extension** target
  - `AIUsageWidget.swift` — everything: snapshot models, decoder, theme, bars,
    small/medium views, timeline provider, the widget (one file, already in this target)
  - `AIUsageWidgetBundle.swift` — `@main` widget bundle (registers the widget)
  - `AIUsageWidgetControl.swift` — intentionally empty (template's Control removed)

All real code is consolidated into the files Xcode generated, so **no files need
to be added to a target** — target membership is already correct.

## Remaining setup (two GUI steps, then build)

1. **App Group capability on BOTH targets.** Select the project (blue icon) →
   pick the `AIUsageWidgetHost` target → Signing & Capabilities → "+ Capability"
   → App Groups → "+" → `group.com.moomoo.aiusagehud`. Repeat for the
   `AIUsageWidget` target. Ensure "Automatically manage signing" is on and your
   personal Team is selected on both.
2. **Build & run** the `AIUsageWidgetHost` scheme (▶). First build mints your
   Apple Development certificate. Running the host app once creates the App Group
   container so the Tauri app can write the snapshot into it.

Then run the write-access spike and add the widget — see plan
`docs/superpowers/plans/2026-06-11-widgetkit-hybrid.md` Tasks 8–9.

## Cross-language contract

The widget decodes the JSON the Tauri app writes; the shapes must stay in sync:
- TS source of truth: `../src/core/snapshot.ts` (`buildSnapshot`)
- Swift mirror: `AIUsageWidgetHost/AIUsageWidget/AIUsageWidget.swift` (the snapshot
  models + `SnapshotStore`)

App Group id (must match the Tauri app's Rust constant in
`../src-tauri/src/commands.rs` → `write_group_snapshot`): `group.com.moomoo.aiusagehud`
Snapshot file: `~/Library/Group Containers/group.com.moomoo.aiusagehud/usage-snapshot.json`

## Free-team signing caveat

Personal-team signatures expire ~7 days. When the widget stops updating/loading,
reopen this Xcode project and Product → Run the host app again to re-sign. A paid
Apple Developer account removes this. The live Tauri panel is unaffected.

## Optional: Swift decoder unit test

Not added yet (no test target was created). To add it later: File → New → Target →
Unit Testing Bundle, then add a test that calls `SnapshotStore.decode(_:)` with a
fixture matching the contract. The TS side already guards the JSON shape.
