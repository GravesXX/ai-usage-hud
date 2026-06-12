// Signed, app-group-entitled helper. Reads snapshot JSON on stdin, writes it into
// the shared App Group container (which it is a legitimate member of, so no macOS
// "access data from other apps" prompt), then tells WidgetKit to redraw.
//
// This is what lets the unentitled Node refresher avoid touching the protected
// container: Node pipes JSON here; this binary does the protected write.
import WidgetKit
import Foundation

let appGroupID = "group.com.moomoo.aiusagehud"
let fileName = "usage-snapshot.json"

let data = FileHandle.standardInput.readDataToEndOfFile()
if data.count > 0,
   let dir = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupID) {
    let url = dir.appendingPathComponent(fileName)
    try? data.write(to: url, options: .atomic)
}

if #available(macOS 11.0, *) {
    WidgetCenter.shared.reloadAllTimelines()
}
// Hold open briefly so the reload request is delivered before exit.
Thread.sleep(forTimeInterval: 2)
