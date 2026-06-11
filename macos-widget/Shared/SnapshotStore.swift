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
