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
