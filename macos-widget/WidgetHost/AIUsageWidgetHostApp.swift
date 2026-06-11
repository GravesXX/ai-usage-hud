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
