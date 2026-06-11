# AI Usage — macOS WidgetKit widget

These Swift sources are imported into an Xcode project (not built by the Tauri
toolchain). See `docs/superpowers/plans/2026-06-11-widgetkit-hybrid.md` Tasks 7–9
for the exact Xcode steps, the App Group write-access spike, and verification.

Layout once imported:
- `WidgetHost/` → the container app target (`AIUsageWidgetHost`)
- `Widget/` → the widget extension target (`AIUsageWidget`)
- `Shared/` → added to BOTH targets (models, decoder, theme)
- `WidgetTests/` → host app's unit test target

App Group id (must match the Tauri app's Rust constant in
`src-tauri/src/commands.rs` → `write_group_snapshot`): `group.com.moomoo.aiusagehud`
Snapshot file: `usage-snapshot.json` in that group's container
(`~/Library/Group Containers/group.com.moomoo.aiusagehud/usage-snapshot.json`).

## Cross-language contract

The widget decodes the JSON the Tauri app writes. The shapes must stay in sync:
- TS source of truth: `src/core/snapshot.ts` (`buildSnapshot`)
- Swift mirror: `Shared/Snapshot.swift`
- Guard: `WidgetTests/SnapshotStoreTests.swift` (decoder unit test)

## Free-team signing caveat

Personal-team signatures expire ~7 days. When the widget stops updating/loading,
reopen this Xcode project and Product → Run the host app again to re-sign.
A paid Apple Developer account removes this. The live Tauri panel is unaffected.
