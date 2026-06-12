// Tiny helper: tell WidgetKit to redraw our widget now. The Node refresher
// writes fresh data but cannot call WidgetKit; this can. Run right after the
// snapshot is written so the on-screen widget actually updates.
import WidgetKit
import Foundation

if #available(macOS 11.0, *) {
    WidgetCenter.shared.reloadAllTimelines()
}
// Hold the process open briefly so the reload request is delivered before exit.
Thread.sleep(forTimeInterval: 2)
