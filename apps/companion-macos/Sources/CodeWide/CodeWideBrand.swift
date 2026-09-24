import AppKit
import SwiftUI

@MainActor
enum CodeWideBrand {
    // Shared with the Android CodeWide palette: nebula, background, and text.
    static let accent = Color(red: 26.0 / 255.0, green: 115.0 / 255.0, blue: 242.0 / 255.0)
    static let graphite = Color(red: 15.0 / 255.0, green: 15.0 / 255.0, blue: 15.0 / 255.0)
    static let warmWhite = Color(red: 242.0 / 255.0, green: 242.0 / 255.0, blue: 242.0 / 255.0)

    static let markImage: NSImage? = {
        guard
            let url = Bundle.main.url(forResource: "CodeWideBrandMark", withExtension: "png"),
            let image = NSImage(contentsOf: url)
        else {
            return nil
        }
        image.isTemplate = true
        return image
    }()
}

struct CodeWideBrandMark: View {
    let size: CGFloat

    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        Group {
            if let image = CodeWideBrand.markImage {
                Image(nsImage: image)
                    .resizable()
                    .interpolation(.high)
                    .renderingMode(.template)
            } else {
                Text("CW")
                    .font(.system(size: size * 0.38, weight: .bold, design: .rounded))
            }
        }
        .frame(width: size, height: size)
        .foregroundStyle(colorScheme == .dark ? CodeWideBrand.warmWhite : CodeWideBrand.graphite)
        .accessibilityLabel("CodeWide")
    }
}
