# WidgetKit Hybrid Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Tasks 1–6 are buildable here (TypeScript + authoring Swift files). Tasks 7–9 are a procedure the human runs in Xcode** — they are documented, not auto-executed.

**Goal:** A native macOS WidgetKit widget (small + medium) that renders a usage snapshot the existing Tauri app writes into a shared App Group container.

**Architecture:** One-way data flow: the Tauri app projects its store to `usage-snapshot.json` in the App Group container on every store change; the widget reads + decodes that file on its OS timeline. Additive to the live panel — no existing behavior changes.

**Tech Stack:** Existing TS/Tauri (Vitest, Rust command), plus Swift/SwiftUI + WidgetKit (Xcode, free personal-team signing).

**Spec:** `docs/superpowers/specs/2026-06-11-widgetkit-hybrid-design.md` — read first.

**Shared constants (must match across Rust + Swift):**
- App Group id: `group.com.moomoo.aiusagehud`
- Snapshot filename: `usage-snapshot.json`
- macOS container path: `~/Library/Group Containers/group.com.moomoo.aiusagehud/usage-snapshot.json`
- Snapshot `version`: `1`

---

## File map

```
ai-usage-hud/
├── src/core/snapshot.ts            # NEW: UsageSnapshot types, buildSnapshot (pure), publishSnapshot
├── src/core/snapshot.test.ts       # NEW
├── src/bridge/types.ts             # MODIFY: add writeGroupSnapshot to NativeBridge
├── src/bridge/fake.ts              # MODIFY: record groupSnapshot
├── src/bridge/tauri.ts             # MODIFY: writeGroupSnapshot -> invoke
├── src/bridge/node.ts              # MODIFY: writeGroupSnapshot -> real group path
├── src/main.tsx                    # MODIFY: subscribe store -> debounced publishSnapshot
├── src-tauri/src/commands.rs       # MODIFY: write_group_snapshot command
├── src-tauri/src/lib.rs            # MODIFY: register command
└── macos-widget/                   # NEW: authored Swift, imported into an Xcode project (Task 7)
    ├── README.md                   # how to create the Xcode project + wire these files
    ├── Shared/Snapshot.swift
    ├── Shared/SnapshotStore.swift
    ├── Shared/Theme.swift
    ├── WidgetHost/AIUsageWidgetHostApp.swift
    ├── WidgetHost/AIUsageWidgetHost.entitlements
    ├── Widget/AIUsageWidget.swift
    ├── Widget/UsageBar.swift
    ├── Widget/SmallView.swift
    ├── Widget/MediumView.swift
    ├── Widget/AIUsageWidget.entitlements
    └── WidgetTests/SnapshotStoreTests.swift
```

Tests colocated for TS (`foo.test.ts`). Swift tests in `WidgetTests/`.

---

### Task 1: Snapshot contract + buildSnapshot (pure projection)

**Files:** Create `src/core/snapshot.ts`, `src/core/snapshot.test.ts`

- [ ] **Step 1: Failing test.** Create `src/core/snapshot.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ProviderView } from "./store";
import { buildSnapshot } from "./snapshot";

const baseView = (over: Partial<ProviderView>): ProviderView => ({
  id: "claude-code", displayName: "Claude Code", state: "ok",
  windows: [], asOf: 1, today: null, active: { active: false }, ...over,
});

describe("buildSnapshot", () => {
  it("projects views to the versioned contract, dropping runtime-only fields", () => {
    const views: ProviderView[] = [
      baseView({
        caption: "max",
        windows: [
          { id: "session", label: "Session", usedPercent: 62, resetsAt: "2026-06-11T01:14:00.000Z" },
          { id: "weekly", label: "Weekly", usedPercent: 28 },
        ],
        today: { tokens: 2502413, costUSD: 6.54, byModel: { "claude-opus-4-8": 2502413 } },
        active: { active: true, model: "x" }, note: "ignore me", asOf: 99,
      }),
    ];
    const snap = buildSnapshot(views, 1781186540979);
    expect(snap.version).toBe(1);
    expect(snap.updatedAt).toBe(1781186540979);
    expect(snap.providers).toEqual([
      {
        id: "claude-code", displayName: "Claude Code", state: "ok", caption: "max",
        windows: [
          { label: "Session", usedPercent: 62, resetsAt: "2026-06-11T01:14:00.000Z" },
          { label: "Weekly", usedPercent: 28, resetsAt: undefined },
        ],
        today: { tokens: 2502413, costUSD: 6.54 },
      },
    ]);
  });
  it("omits today when the view has none, and caption when absent", () => {
    const snap = buildSnapshot([baseView({ today: null })], 5);
    expect(snap.providers[0].today).toBeUndefined();
    expect(snap.providers[0].caption).toBeUndefined();
  });
  it("preserves non-ok states for the widget to dim", () => {
    const snap = buildSnapshot([baseView({ state: "unconfigured" })], 5);
    expect(snap.providers[0].state).toBe("unconfigured");
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/core/snapshot.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement.** Create `src/core/snapshot.ts`:

```ts
import type { NativeBridge } from "../bridge/types";
import type { ProviderState } from "../providers/types";
import type { ProviderView } from "./store";

export interface WindowSnapshot { label: string; usedPercent: number; resetsAt?: string }
export interface TodaySnapshot { tokens: number; costUSD?: number }
export interface ProviderSnapshot {
  id: string;
  displayName: string;
  state: ProviderState;
  caption?: string;
  windows: WindowSnapshot[];
  today?: TodaySnapshot;
}
export interface UsageSnapshot {
  version: number;
  updatedAt: number;
  providers: ProviderSnapshot[];
}

export const SNAPSHOT_VERSION = 1;

/** Pure projection of store views to the cross-language widget contract. */
export function buildSnapshot(views: ProviderView[], now: number): UsageSnapshot {
  return {
    version: SNAPSHOT_VERSION,
    updatedAt: now,
    providers: views.map((v) => ({
      id: v.id,
      displayName: v.displayName,
      state: v.state,
      caption: v.caption,
      windows: v.windows.map((w) => ({ label: w.label, usedPercent: w.usedPercent, resetsAt: w.resetsAt })),
      today: v.today ? { tokens: v.today.tokens, costUSD: v.today.costUSD } : undefined,
    })),
  };
}

/** Build + write the snapshot to the App Group container. Best-effort. */
export async function publishSnapshot(bridge: NativeBridge, views: ProviderView[], now: number): Promise<void> {
  await bridge.writeGroupSnapshot(JSON.stringify(buildSnapshot(views, now)));
}
```

(Note: `publishSnapshot` references `bridge.writeGroupSnapshot`, added in Task 2. TypeScript will error until then — that's expected; Task 2 immediately follows. If running Task 1 standalone, temporarily it won't typecheck; complete Task 2 before the tsc gate.)

- [ ] **Step 4: Run tests** — `npx vitest run src/core/snapshot.test.ts` → PASS (the test only uses `buildSnapshot`, which doesn't touch the bridge, so it passes even before Task 2).

- [ ] **Step 5: Commit** — `git add src/core/snapshot.ts src/core/snapshot.test.ts && git commit -m "feat: usage snapshot contract and pure projection"`

---

### Task 2: writeGroupSnapshot bridge method + Rust command

**Files:** Modify `src/bridge/types.ts`, `src/bridge/fake.ts`, `src/bridge/tauri.ts`, `src/bridge/node.ts`, `src-tauri/src/commands.rs`, `src-tauri/src/lib.rs`

- [ ] **Step 1: Extend the interface.** In `src/bridge/types.ts`, add to the `NativeBridge` interface (after `writeCache`):

```ts
  /** Write the widget snapshot JSON into the shared App Group container. Best-effort. */
  writeGroupSnapshot(json: string): Promise<void>;
```

- [ ] **Step 2: FakeBridge.** In `src/bridge/fake.ts`, add a field and method:

```ts
  groupSnapshot: string | null = null;
```
and
```ts
  async writeGroupSnapshot(json: string) { this.groupSnapshot = json; }
```

- [ ] **Step 3: Rust command.** Append to `src-tauri/src/commands.rs`:

```rust
/// Writes the widget snapshot into the shared App Group container.
/// Group id is fixed and must match the Swift widget's entitlement.
#[tauri::command]
pub fn write_group_snapshot(json: String) -> Result<(), String> {
    const GROUP_ID: &str = "group.com.moomoo.aiusagehud";
    let home = std::env::var("HOME").map_err(|e| e.to_string())?;
    let dir = format!("{home}/Library/Group Containers/{GROUP_ID}");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::write(format!("{dir}/usage-snapshot.json"), json).map_err(|e| e.to_string())
}
```

- [ ] **Step 4: Register it.** In `src-tauri/src/lib.rs`, add `commands::write_group_snapshot` to the `generate_handler![...]` list:

```rust
        .invoke_handler(tauri::generate_handler![
            commands::read_keychain,
            commands::check_processes,
            commands::get_cli_version,
            commands::write_group_snapshot
        ])
```

- [ ] **Step 5: TauriBridge.** In `src/bridge/tauri.ts`, add the method (uses the already-imported `invoke`):

```ts
  writeGroupSnapshot(json: string): Promise<void> {
    return invoke<void>("write_group_snapshot", { json });
  }
```

- [ ] **Step 6: NodeBridge.** In `src/bridge/node.ts`, add (writes to the real group path so the probe/spike can populate the widget):

```ts
  async writeGroupSnapshot(json: string): Promise<void> {
    const dir = path.join(os.homedir(), "Library", "Group Containers", "group.com.moomoo.aiusagehud");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "usage-snapshot.json"), json, "utf8");
  }
```

- [ ] **Step 7: Verify** — Run: `npx tsc --noEmit` → clean (all four NativeBridge implementors now satisfy the interface; `publishSnapshot` from Task 1 now typechecks). `cd src-tauri && cargo check && cd ..` → clean. `npx vitest run` → all prior tests + Task 1 pass.

- [ ] **Step 8: Commit** — `git add -A && git commit -m "feat: writeGroupSnapshot bridge method and Rust command"`

---

### Task 3: Publish snapshot on store changes (wire-up + test)

**Files:** Create `src/core/snapshot-publish.test.ts`; Modify `src/main.tsx`

- [ ] **Step 1: Failing test** for the publish glue. Create `src/core/snapshot-publish.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FakeBridge } from "../bridge/fake";
import type { ProviderView } from "./store";
import { publishSnapshot } from "./snapshot";

const view = (id: string): ProviderView => ({
  id, displayName: id, state: "ok", windows: [{ id: "session", label: "S", usedPercent: 5 }],
  asOf: 1, today: { tokens: 10 }, active: { active: false },
});

describe("publishSnapshot", () => {
  it("writes the serialized snapshot through the bridge", async () => {
    const b = new FakeBridge();
    await publishSnapshot(b, [view("claude-code"), view("codex")], 123);
    expect(b.groupSnapshot).not.toBeNull();
    const parsed = JSON.parse(b.groupSnapshot!);
    expect(parsed.version).toBe(1);
    expect(parsed.updatedAt).toBe(123);
    expect(parsed.providers.map((p: { id: string }) => p.id)).toEqual(["claude-code", "codex"]);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/core/snapshot-publish.test.ts` → it should actually PASS already (publishSnapshot + FakeBridge exist from Tasks 1–2). This task's test is a guard; if it passes immediately, that's fine — proceed. (TDD note: the *behavior* under test is the wiring in Step 3; this unit test pins the publish primitive.)

- [ ] **Step 3: Wire into main.tsx.** In `src/main.tsx`, add the import and a debounced store subscription. Add near the other imports:

```tsx
import { publishSnapshot } from "./core/snapshot";
```

And after the `void restorePosition().then(...)` line (and after `initAutostartDefault` if present), add:

```tsx
// Mirror the store into the App Group snapshot for the WidgetKit widget (debounced, best-effort).
let snapshotTimer: ReturnType<typeof setTimeout> | undefined;
hudStore.subscribe((s) => {
  clearTimeout(snapshotTimer);
  snapshotTimer = setTimeout(() => {
    void publishSnapshot(bridge, Object.values(s.providers), Date.now()).catch(() => {
      /* group container may not exist until the widget host app has run once */
    });
  }, 1000);
});
```

- [ ] **Step 4: Verify** — `npx tsc --noEmit` → clean. `npx vitest run` → all pass. `npm run build` → succeeds.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: publish usage snapshot to App Group on store changes"`

---

### Task 4: Swift snapshot models + decoder + XCTest (authored files)

**Files:** Create `macos-widget/Shared/Snapshot.swift`, `macos-widget/Shared/SnapshotStore.swift`, `macos-widget/WidgetTests/SnapshotStoreTests.swift`

These are authored now; they compile inside the Xcode project (Task 7). The decoder is the cross-language contract guard.

- [ ] **Step 1: Codable models.** Create `macos-widget/Shared/Snapshot.swift`:

```swift
import Foundation

struct UsageSnapshot: Codable {
    let version: Int
    let updatedAt: Double          // epoch ms
    let providers: [ProviderSnapshot]
}

struct ProviderSnapshot: Codable, Identifiable {
    let id: String
    let displayName: String
    let state: String              // "ok" | "stale" | "unconfigured" | "error"
    let caption: String?
    let windows: [WindowSnapshot]
    let today: TodaySnapshot?
}

struct WindowSnapshot: Codable, Identifiable {
    var id: String { label }
    let label: String
    let usedPercent: Double
    let resetsAt: String?          // ISO-8601
}

struct TodaySnapshot: Codable {
    let tokens: Double
    let costUSD: Double?
}
```

- [ ] **Step 2: Decoder/store.** Create `macos-widget/Shared/SnapshotStore.swift`:

```swift
import Foundation

enum SnapshotStore {
    static let appGroupID = "group.com.moomoo.aiusagehud"
    static let fileName = "usage-snapshot.json"
    static let supportedVersion = 1

    /// Resolve the snapshot file URL inside the shared App Group container.
    static func fileURL() -> URL? {
        FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: appGroupID)?
            .appendingPathComponent(fileName)
    }

    /// Decode the current snapshot, or nil if missing/unreadable/incompatible.
    static func load() -> UsageSnapshot? {
        guard let url = fileURL(),
              let data = try? Data(contentsOf: url) else { return nil }
        return decode(data)
    }

    /// Pure decode (testable without the filesystem).
    static func decode(_ data: Data) -> UsageSnapshot? {
        guard let snap = try? JSONDecoder().decode(UsageSnapshot.self, from: data),
              snap.version == supportedVersion else { return nil }
        return snap
    }
}
```

- [ ] **Step 3: XCTest.** Create `macos-widget/WidgetTests/SnapshotStoreTests.swift`:

```swift
import XCTest
@testable import AIUsageWidgetHost  // host app target hosts the shared sources

final class SnapshotStoreTests: XCTestCase {
    func testDecodesValidSnapshot() throws {
        let json = """
        {"version":1,"updatedAt":1781186540979,"providers":[
          {"id":"claude-code","displayName":"Claude Code","state":"ok","caption":"max",
           "windows":[{"label":"Session","usedPercent":62,"resetsAt":"2026-06-11T01:14:00.000Z"},
                      {"label":"Weekly","usedPercent":28}],
           "today":{"tokens":2502413,"costUSD":6.54}}]}
        """.data(using: .utf8)!
        let snap = SnapshotStore.decode(json)
        XCTAssertNotNil(snap)
        XCTAssertEqual(snap?.providers.first?.displayName, "Claude Code")
        XCTAssertEqual(snap?.providers.first?.windows.count, 2)
        XCTAssertNil(snap?.providers.first?.windows[1].resetsAt)
        XCTAssertEqual(snap?.providers.first?.today?.costUSD, 6.54)
    }

    func testRejectsWrongVersion() {
        let json = #"{"version":2,"updatedAt":1,"providers":[]}"#.data(using: .utf8)!
        XCTAssertNil(SnapshotStore.decode(json))
    }

    func testRejectsGarbage() {
        XCTAssertNil(SnapshotStore.decode(Data("not json".utf8)))
    }
}
```

- [ ] **Step 4: Verify (deferred to Xcode).** These files have no build system yet. Verification happens in Task 7 once the Xcode targets exist: `⌘U` runs `SnapshotStoreTests` (3 tests pass). No action here beyond authoring.

- [ ] **Step 5: Commit** — `git add macos-widget/Shared macos-widget/WidgetTests && git commit -m "feat(widget): Swift snapshot models, decoder, and decoder tests"`

---

### Task 5: Widget SwiftUI views + timeline (authored files)

**Files:** Create `macos-widget/Shared/Theme.swift`, `macos-widget/Widget/UsageBar.swift`, `macos-widget/Widget/SmallView.swift`, `macos-widget/Widget/MediumView.swift`, `macos-widget/Widget/AIUsageWidget.swift`

- [ ] **Step 1: Theme.** Create `macos-widget/Shared/Theme.swift`:

```swift
import SwiftUI

enum Theme {
    static let bg = Color(red: 0x26/255, green: 0x26/255, blue: 0x24/255)
    static let text = Color(red: 0xfa/255, green: 0xf9/255, blue: 0xf5/255)
    static let muted = Color(red: 0xfa/255, green: 0xf9/255, blue: 0xf5/255).opacity(0.55)
    static let accent = Color(red: 0xd9/255, green: 0x77/255, blue: 0x57/255)
    static let amber = Color(red: 0xff/255, green: 0xb2/255, blue: 0x24/255)
    static let red = Color(red: 0xe5/255, green: 0x48/255, blue: 0x4d/255)
    static let track = Color(red: 0xfa/255, green: 0xf9/255, blue: 0xf5/255).opacity(0.12)

    /// Matches the panel's barColor: neutral -> amber >= 70 -> red >= 90.
    static func barColor(_ p: Double) -> Color {
        if p >= 90 { return red }
        if p >= 70 { return amber }
        return accent
    }

    /// Absolute local reset time, e.g. "6:14 PM", from an ISO-8601 string.
    static func resetLabel(_ iso: String?) -> String? {
        guard let iso, let date = isoFormatter.date(from: iso) ?? isoFormatterNoFrac.date(from: iso) else { return nil }
        let f = DateFormatter(); f.timeStyle = .short; f.dateStyle = .none
        return f.string(from: date)
    }
    private static let isoFormatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f
    }()
    private static let isoFormatterNoFrac: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime]; return f
    }()

    static func updatedAgo(_ updatedAtMs: Double) -> String {
        let mins = Int((Date().timeIntervalSince1970 * 1000 - updatedAtMs) / 60000)
        if mins < 1 { return "just now" }
        if mins < 60 { return "\(mins)m ago" }
        return "\(mins / 60)h ago"
    }
}
```

- [ ] **Step 2: Bar.** Create `macos-widget/Widget/UsageBar.swift`:

```swift
import SwiftUI

struct UsageBar: View {
    let label: String
    let percent: Double
    var resetISO: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text(label).foregroundStyle(Theme.text)
                Spacer()
                Text("\(Int(percent.rounded()))%").foregroundStyle(Theme.text)
            }.font(.system(size: 11))
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 3).fill(Theme.track)
                    RoundedRectangle(cornerRadius: 3)
                        .fill(Theme.barColor(percent))
                        .frame(width: max(0, min(1, percent / 100)) * geo.size.width)
                }
            }.frame(height: 5)
        }
    }
}
```

- [ ] **Step 3: Small view.** Create `macos-widget/Widget/SmallView.swift`:

```swift
import SwiftUI

struct SmallView: View {
    let snapshot: UsageSnapshot?

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            Text("⚡ AI Usage").font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.accent)
            if let snap = snapshot, !snap.providers.isEmpty {
                ForEach(snap.providers) { p in
                    let session = p.windows.first
                    UsageBar(label: shortName(p.displayName), percent: session?.usedPercent ?? 0)
                        .opacity(p.state == "ok" ? 1 : 0.5)
                }
                Spacer(minLength: 0)
                Text(Theme.updatedAgo(snap.updatedAt)).font(.system(size: 9)).foregroundStyle(Theme.muted)
            } else {
                Spacer()
                Text("Open AI Usage HUD").font(.system(size: 10)).foregroundStyle(Theme.muted)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .containerBackground(Theme.bg, for: .widget)
    }
    private func shortName(_ n: String) -> String { n == "Claude Code" ? "Claude" : n }
}
```

- [ ] **Step 4: Medium view.** Create `macos-widget/Widget/MediumView.swift`:

```swift
import SwiftUI

struct MediumView: View {
    let snapshot: UsageSnapshot?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("⚡ AI Usage").font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.accent)
                Spacer()
                if let snap = snapshot { Text(Theme.updatedAgo(snap.updatedAt)).font(.system(size: 9)).foregroundStyle(Theme.muted) }
            }
            if let snap = snapshot, !snap.providers.isEmpty {
                HStack(alignment: .top, spacing: 14) {
                    ForEach(snap.providers) { p in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(p.displayName).font(.system(size: 11, weight: .medium)).foregroundStyle(Theme.text)
                            if p.state == "unconfigured" {
                                Text("not set up").font(.system(size: 10)).foregroundStyle(Theme.muted)
                            } else {
                                ForEach(p.windows) { w in UsageBar(label: w.label, percent: w.usedPercent) }
                                if let reset = Theme.resetLabel(p.windows.first?.resetsAt) {
                                    Text("↻ \(reset)").font(.system(size: 9)).foregroundStyle(Theme.muted)
                                }
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .opacity(p.state == "ok" || p.state == "unconfigured" ? 1 : 0.5)
                    }
                }
            } else {
                Spacer()
                Text("Open AI Usage HUD to start tracking").font(.system(size: 11)).foregroundStyle(Theme.muted)
                Spacer()
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .containerBackground(Theme.bg, for: .widget)
    }
}
```

- [ ] **Step 5: Widget + timeline.** Create `macos-widget/Widget/AIUsageWidget.swift`:

```swift
import WidgetKit
import SwiftUI

struct UsageEntry: TimelineEntry {
    let date: Date
    let snapshot: UsageSnapshot?
}

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> UsageEntry { UsageEntry(date: Date(), snapshot: nil) }

    func getSnapshot(in context: Context, completion: @escaping (UsageEntry) -> Void) {
        completion(UsageEntry(date: Date(), snapshot: SnapshotStore.load()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<UsageEntry>) -> Void) {
        let entry = UsageEntry(date: Date(), snapshot: SnapshotStore.load())
        // Re-read ~10 min out; WidgetKit honors within its budget.
        let next = Calendar.current.date(byAdding: .minute, value: 10, to: Date())!
        completion(Timeline(entries: [entry], policy: .after(next)))
    }
}

struct AIUsageWidgetEntryView: View {
    @Environment(\.widgetFamily) var family
    var entry: Provider.Entry

    var body: some View {
        switch family {
        case .systemSmall: SmallView(snapshot: entry.snapshot)
        default: MediumView(snapshot: entry.snapshot)
        }
    }
}

@main
struct AIUsageWidget: Widget {
    let kind = "AIUsageWidget"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: Provider()) { entry in
            AIUsageWidgetEntryView(entry: entry)
        }
        .configurationDisplayName("AI Usage")
        .description("Claude Code & Codex usage limits.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}
```

- [ ] **Step 6: Commit** — `git add macos-widget/Shared/Theme.swift macos-widget/Widget && git commit -m "feat(widget): SwiftUI small/medium views, theme, timeline provider"`

---

### Task 6: Host app + entitlements + import README (authored files)

**Files:** Create `macos-widget/WidgetHost/AIUsageWidgetHostApp.swift`, `macos-widget/WidgetHost/AIUsageWidgetHost.entitlements`, `macos-widget/Widget/AIUsageWidget.entitlements`, `macos-widget/README.md`

- [ ] **Step 1: Host app.** Create `macos-widget/WidgetHost/AIUsageWidgetHostApp.swift`:

```swift
import SwiftUI

@main
struct AIUsageWidgetHostApp: App {
    var body: some Scene {
        WindowGroup {
            VStack(spacing: 12) {
                Text("⚡ AI Usage Widget").font(.title2).bold()
                Text("Add the widget from the desktop widget gallery\n(right-click the desktop → Edit Widgets → AI Usage).")
                    .multilineTextAlignment(.center).foregroundStyle(.secondary)
                Text("Live data comes from the AI Usage HUD app, which must be running.")
                    .font(.caption).foregroundStyle(.secondary).multilineTextAlignment(.center)
            }
            .padding(40)
            .frame(width: 420, height: 200)
        }
        .windowResizability(.contentSize)
    }
}
```

- [ ] **Step 2: Host entitlements.** Create `macos-widget/WidgetHost/AIUsageWidgetHost.entitlements`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.security.app-sandbox</key>
    <true/>
    <key>com.apple.security.application-groups</key>
    <array>
        <string>group.com.moomoo.aiusagehud</string>
    </array>
</dict>
</plist>
```

- [ ] **Step 3: Widget entitlements.** Create `macos-widget/Widget/AIUsageWidget.entitlements`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.security.app-sandbox</key>
    <true/>
    <key>com.apple.security.application-groups</key>
    <array>
        <string>group.com.moomoo.aiusagehud</string>
    </array>
</dict>
</plist>
```

- [ ] **Step 4: Import README.** Create `macos-widget/README.md`:

```markdown
# AI Usage — macOS WidgetKit widget

These Swift sources are imported into an Xcode project (not built by the Tauri
toolchain). See `docs/superpowers/plans/2026-06-11-widgetkit-hybrid.md` Task 7
for the exact Xcode steps.

Layout once imported:
- `WidgetHost/` → the container app target (`AIUsageWidgetHost`)
- `Widget/` → the widget extension target (`AIUsageWidget`)
- `Shared/` → added to BOTH targets (models, decoder, theme)
- `WidgetTests/` → host app's unit test target

App Group id (must match the Tauri app's Rust constant): `group.com.moomoo.aiusagehud`
Snapshot file: `usage-snapshot.json` in that group's container.
```

- [ ] **Step 5: Commit** — `git add macos-widget/WidgetHost macos-widget/Widget/AIUsageWidget.entitlements macos-widget/README.md && git commit -m "feat(widget): host app, App Group entitlements, import readme"`

---

### Task 7: Create the Xcode project & wire the targets (HUMAN, in Xcode)

This task is a procedure the human runs in Xcode. Each step is verifiable. Do them in order.

- [ ] **Step 1: Signing identity.** Xcode → Settings (⌘,) → Accounts → "+" → Apple ID → sign in. Confirm a "Personal Team" appears.

- [ ] **Step 2: New project.** File → New → Project → macOS → App. Product Name `AIUsageWidgetHost`; Interface SwiftUI; Language Swift; Team = your Personal Team; **save it inside `~/Desktop/ai-usage-hud/macos-widget/`** (so the `.xcodeproj` sits next to the authored sources). Bundle id will be `com.moomoo.AIUsageWidgetHost` (or similar — note the team prefix).

- [ ] **Step 2b: Verify cert minted.** Build the empty app once (⌘B). Then in Terminal: `security find-identity -v -p codesigning` → should now list `Apple Development: <your email>`. (If it errors about signing, in target → Signing & Capabilities ensure "Automatically manage signing" is on and the Team is set.)

- [ ] **Step 3: Add the widget extension target.** File → New → Target → macOS → Widget Extension. Name `AIUsageWidget`. **Uncheck** "Include Live Activity" and "Include Configuration App Intent" (we use StaticConfiguration). Activate the scheme if prompted.

- [ ] **Step 4: Replace generated sources with the authored files.** Delete the template `.swift` files Xcode generated for both targets. Add the authored files (drag from Finder, "Copy items if needed" OFF since they're already in the folder, add to the correct target):
  - `WidgetHost/AIUsageWidgetHostApp.swift` → AIUsageWidgetHost target only.
  - `Widget/*.swift` (AIUsageWidget, UsageBar, SmallView, MediumView) → AIUsageWidget target only.
  - `Shared/*.swift` (Snapshot, SnapshotStore, Theme) → **both** targets (select both in the File Inspector "Target Membership").
  - `WidgetTests/SnapshotStoreTests.swift` → the AIUsageWidgetHostTests target (create a Unit Testing Bundle target if the project wizard didn't: File → New → Target → Unit Testing Bundle, name `AIUsageWidgetHostTests`).

- [ ] **Step 5: App Group capability on BOTH targets.** For AIUsageWidgetHost and AIUsageWidget: target → Signing & Capabilities → "+ Capability" → App Groups → "+" → enter `group.com.moomoo.aiusagehud`. Confirm both targets list the same group, and that Xcode wrote it into each target's `.entitlements` (it may create its own; ensure the value matches — if Xcode created fresh entitlements files, the authored ones are reference copies, that's fine).

- [ ] **Step 6: Build & test.** ⌘B builds both targets clean. ⌘U runs `SnapshotStoreTests` → 3 tests pass (this is the cross-language contract guard).

- [ ] **Step 7: Commit the project** — In Terminal: `cd ~/Desktop/ai-usage-hud && git add macos-widget && git commit -m "feat(widget): Xcode project wiring the host app and widget extension"`. (The `.xcodeproj` is fine to commit; it's a personal project.)

---

### Task 8: App Group write-access spike (the one validated risk)

Confirms the non-sandboxed Tauri app can write into the group container the sandboxed widget reads.

- [ ] **Step 1: Create the container.** Run the `AIUsageWidgetHost` app once from Xcode (▶). This makes macOS create `~/Library/Group Containers/group.com.moomoo.aiusagehud/`. Verify in Terminal: `ls -ld ~/Library/Group\ Containers/group.com.moomoo.aiusagehud` → directory exists.

- [ ] **Step 2: Have the Tauri-side write into it.** Add a reusable spike script (also handy for manually refreshing the widget when only the probe is run). Create `scripts/spike-write-snapshot.ts`:

```ts
import { NodeBridge } from "../src/bridge/node";
import { createProviders } from "../src/providers/registry";
import { publishSnapshot } from "../src/core/snapshot";
import type { ProviderView } from "../src/core/store";

async function main() {
  const bridge = new NodeBridge();
  const views: ProviderView[] = [];
  for (const p of createProviders(bridge)) {
    try {
      const windows = await p.fetchLimits();
      const today = await p.fetchTodayStats().catch(() => null);
      views.push({ id: p.id, displayName: p.displayName, state: "ok", windows, asOf: Date.now(), today, active: { active: false }, caption: p.caption });
    } catch {
      views.push({ id: p.id, displayName: p.displayName, state: "error", windows: [], asOf: null, today: null, active: { active: false } });
    }
  }
  await publishSnapshot(bridge, views, Date.now());
  console.log("wrote snapshot for", views.map((v) => v.id).join(", "));
}
main();
```

Run it, then read the file back:

```bash
cd ~/Desktop/ai-usage-hud
npx tsx scripts/spike-write-snapshot.ts
head -c 200 ~/Library/Group\ Containers/group.com.moomoo.aiusagehud/usage-snapshot.json; echo
```

Expected: "wrote snapshot for claude-code, codex" and the file's first 200 chars print (real provider data).

- [ ] **Step 2 PASS path:** the file wrote and reads back → the non-sandboxed write works. No Tauri re-signing needed. Proceed to Task 9.

- [ ] **Step 2 FAIL path (permission denied):** if the write is denied, take the fallback — sign the Tauri app with the App Group entitlement:
  1. Create `src-tauri/entitlements.plist` with the same `com.apple.security.application-groups` array (value `group.com.moomoo.aiusagehud`) — NO app-sandbox key (the Tauri app stays non-sandboxed; the group entitlement alone grants container access).
  2. In `src-tauri/tauri.conf.json` under `bundle.macOS`, set `"entitlements": "entitlements.plist"` and set `"signingIdentity"` to your `Apple Development: <email>` identity (from `security find-identity`).
  3. `npm run tauri build` (signs the app), launch the built app, re-run the Step 2 write test. Document that the Tauri app now also follows the 7-day cert cycle.

- [ ] **Step 3: Note the outcome** in `macos-widget/README.md` (which path was taken). Commit if the fallback files were added.

---

### Task 9: End-to-end verification & free-team caveat (HUMAN)

- [ ] **Step 1: Snapshot is fresh from the real app.** Quit any dev instance, run the real Tauri app: `cd ~/Desktop/ai-usage-hud && npm run tauri dev`. Within ~a minute, confirm the snapshot updates: `stat -f '%Sm' ~/Library/Group\ Containers/group.com.moomoo.aiusagehud/usage-snapshot.json` shows a recent time.

- [ ] **Step 2: Add the widget.** Right-click the desktop → Edit Widgets (or click the date/time in the menu bar → Edit Widgets) → find "AI Usage" → add both the Small and Medium. They should render your real Claude/Codex percentages (possibly after up to ~10 min for the first OS refresh; force it by toggling the widget off/on).

- [ ] **Step 3: Acceptance checklist:**
  - Small + Medium both show real percentages matching the live panel / `/usage` / `/status`.
  - Bars are amber ≥70%, red ≥90%.
  - "updated Nm ago" reflects recency; reset times show as absolute clock times.
  - With the Tauri app quit for a while, the widget shows the last snapshot (stale) — not a crash.

- [ ] **Step 4: Document the 7-day re-sign.** Add to `macos-widget/README.md`: "Free personal-team signatures expire ~7 days. When the widget stops updating/loading, reopen the Xcode project and Product → Run the host app again to re-sign. A paid Apple Developer account removes this." Commit.

---

## Notes for the executor

- **Tasks 1–6 are fully buildable here** (TS tests + tsc + cargo + authoring Swift text files). Execute them with subagent-driven-development and the normal review gates.
- **Tasks 7–9 require Xcode and the user's Apple ID** — they are a documented procedure for the human, not auto-executed. After Tasks 1–6, hand the user the Task 7–9 checklist.
- The cross-language contract is the snapshot JSON. The TS `buildSnapshot` (Task 1) and the Swift `Snapshot.swift`/decoder (Task 4) must stay in sync; the field-by-field shapes in those two tasks are the source of truth, guarded by `SnapshotStoreTests`.

