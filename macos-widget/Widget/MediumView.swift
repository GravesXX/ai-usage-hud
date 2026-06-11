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
