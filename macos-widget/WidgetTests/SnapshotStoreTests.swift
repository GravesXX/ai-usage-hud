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
