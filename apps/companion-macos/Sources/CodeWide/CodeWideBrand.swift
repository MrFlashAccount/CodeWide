import AppKit
import SwiftUI

@MainActor
enum CodeWideBrand {
    // Product colors from brand/BRAND.md; native surfaces keep system neutrals.
    static let accent = Color(red: 88.0 / 255.0, green: 120.0 / 255.0, blue: 1)
    // Darker brand tint keeps white action labels legible in both appearances.
    static let actionAccent = Color(red: 65.0 / 255.0, green: 91.0 / 255.0, blue: 215.0 / 255.0)
    static let graphite = Color(red: 15.0 / 255.0, green: 15.0 / 255.0, blue: 16.0 / 255.0)
    static let warmWhite = Color(red: 244.0 / 255.0, green: 244.0 / 255.0, blue: 245.0 / 255.0)

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
