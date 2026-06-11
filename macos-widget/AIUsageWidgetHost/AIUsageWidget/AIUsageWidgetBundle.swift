//
//  AIUsageWidgetBundle.swift
//  AIUsageWidget
//
//  The widget extension entry point. Only our AI Usage widget — the template's
//  Control widget is removed (AIUsageWidgetControl.swift is intentionally empty).
//

import WidgetKit
import SwiftUI

@main
struct AIUsageWidgetBundle: WidgetBundle {
    var body: some Widget {
        AIUsageWidget()
    }
}
