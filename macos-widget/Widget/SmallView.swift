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
