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
