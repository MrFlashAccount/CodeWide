import SwiftUI

struct ShimmerText: View {
    private let text: String

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(_ text: String) {
        self.text = text
    }

    var body: some View {
        if reduceMotion {
            Text(text)
                .foregroundStyle(.secondary)
        } else {
            TimelineView(.animation(minimumInterval: 1.0 / 30.0)) { context in
                let phase = context.date.timeIntervalSinceReferenceDate
                    .truncatingRemainder(dividingBy: 1.4) / 1.4
                Text(text)
                    .foregroundStyle(
                        LinearGradient(
                            colors: [
                                Color.secondary,
                                Color.primary.opacity(0.95),
                                Color.secondary,
                            ],
                            startPoint: UnitPoint(x: phase * 2.0 - 1.0, y: 0.5),
                            endPoint: UnitPoint(x: phase * 2.0, y: 0.5)
                        )
                    )
            }
        }
    }
}
