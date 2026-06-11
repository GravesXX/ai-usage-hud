//
//  AIUsageWidget.swift
//  AIUsageWidget
//
//  The whole widget (models, decoder, theme, views, timeline) consolidated into
//  this one file so it lives entirely in the widget extension target — no extra
//  files need adding to the target in Xcode. The @main entry point is in
//  AIUsageWidgetBundle.swift.
//

import Foundation
import WidgetKit
import SwiftUI

// MARK: - Snapshot models (must match the Tauri app's src/core/snapshot.ts contract)

struct UsageSnapshot: Codable {
    let version: Int
    let updatedAt: Double            // epoch ms
    let providers: [ProviderSnapshot]
}

struct ProviderSnapshot: Codable, Identifiable {
    let id: String
    let displayName: String
    let state: String                // "ok" | "stale" | "unconfigured" | "error"
    let caption: String?
    let windows: [WindowSnapshot]
    let today: TodaySnapshot?
}

struct WindowSnapshot: Codable, Identifiable {
    var id: String { label }
    let label: String
    let usedPercent: Double
    let resetsAt: String?            // ISO-8601
}

struct TodaySnapshot: Codable {
    let tokens: Double
    let costUSD: Double?
}

// MARK: - Snapshot store (reads the shared App Group container)

enum SnapshotStore {
    static let appGroupID = "group.com.moomoo.aiusagehud"
    static let fileName = "usage-snapshot.json"
    static let supportedVersion = 1

    static func fileURL() -> URL? {
        FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: appGroupID)?
            .appendingPathComponent(fileName)
    }

    static func load() -> UsageSnapshot? {
        guard let url = fileURL(), let data = try? Data(contentsOf: url) else { return nil }
        return decode(data)
    }

    static func decode(_ data: Data) -> UsageSnapshot? {
        guard let snap = try? JSONDecoder().decode(UsageSnapshot.self, from: data),
              snap.version == supportedVersion else { return nil }
        return snap
    }
}

// MARK: - Theme (Claude palette, mirrors src/ui/colors.ts barColor)

enum Theme {
    static let bg = Color(red: 0x26/255, green: 0x26/255, blue: 0x24/255)
    static let text = Color(red: 0xfa/255, green: 0xf9/255, blue: 0xf5/255)
    static let muted = Color(red: 0xfa/255, green: 0xf9/255, blue: 0xf5/255).opacity(0.55)
    static let accent = Color(red: 0xd9/255, green: 0x77/255, blue: 0x57/255)
    static let amber = Color(red: 0xff/255, green: 0xb2/255, blue: 0x24/255)
    static let red = Color(red: 0xe5/255, green: 0x48/255, blue: 0x4d/255)
    static let track = Color(red: 0xfa/255, green: 0xf9/255, blue: 0xf5/255).opacity(0.12)

    static func barColor(_ p: Double) -> Color {
        if p >= 90 { return red }
        if p >= 70 { return amber }
        return accent
    }

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

// MARK: - Bar

struct UsageBar: View {
    let label: String
    let percent: Double

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

// MARK: - Small + Medium views

struct SmallView: View {
    let snapshot: UsageSnapshot?

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            Text("⚡ AI Usage").font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.accent)
            if let snap = snapshot, !snap.providers.isEmpty {
                ForEach(snap.providers) { p in
                    UsageBar(label: shortName(p.displayName), percent: p.windows.first?.usedPercent ?? 0)
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

// MARK: - Timeline + widget

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
