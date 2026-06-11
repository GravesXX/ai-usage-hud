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
