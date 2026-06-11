import SwiftUI

struct UsageBar: View {
    let label: String
    let percent: Double

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text(label).foregroundStyle(Theme.text)
                Spacer()
                Text("\(Int(percent.rounded()))%").foregroundStyle(Theme.text)
            }.font(.system(size: 11))
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 3).fill(Theme.track)
                    RoundedRectangle(cornerRadius: 3)
                        .fill(Theme.barColor(percent))
                        .frame(width: max(0, min(1, percent / 100)) * geo.size.width)
                }
            }.frame(height: 5)
        }
    }
}
