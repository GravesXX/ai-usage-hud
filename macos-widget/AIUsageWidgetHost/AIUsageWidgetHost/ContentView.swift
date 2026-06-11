//
//  ContentView.swift
//  AIUsageWidgetHost
//
//  Minimal launcher window. This app exists so the widget extension has a host
//  to live in and to register the widget in the gallery; the live data comes
//  from the AI Usage HUD (Tauri) app via the shared App Group container.
//

import SwiftUI

struct ContentView: View {
    var body: some View {
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
}

#Preview {
    ContentView()
}
