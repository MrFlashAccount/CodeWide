import AppKit
import SwiftUI

@MainActor
enum AgentProviderAssets {
    static func image(providerID: String) -> NSImage? {
        switch providerID {
        case "codex": codex
        case "claude": claude
        default: nil
        }
    }

    private static let codex = load("AgentProviderCodex")
    private static let claude = load("AgentProviderClaude")

    private static func load(_ name: String) -> NSImage? {
        let url = Bundle.main.url(forResource: name, withExtension: "svg")
            ?? packagedURL(name)
        guard let image = url.flatMap(NSImage.init(contentsOf:)) else { return nil }
        image.isTemplate = true
        return image
    }

    private static func packagedURL(_ name: String) -> URL? {
        #if SWIFT_PACKAGE
        Bundle.module.url(
            forResource: name,
            withExtension: "svg",
            subdirectory: "AgentProviders"
        )
        #else
        nil
        #endif
    }
}

struct AgentProviderIcon: View {
    let providerID: String
    let size: CGFloat

    var body: some View {
        Group {
            if let image = AgentProviderAssets.image(providerID: providerID) {
                Image(nsImage: image)
                    .resizable()
                    .renderingMode(.template)
                    .interpolation(.high)
                    .scaledToFit()
            } else {
                Image(systemName: "cpu")
                    .resizable()
                    .scaledToFit()
                    .padding(size * 0.16)
            }
        }
        .frame(width: size, height: size)
        .foregroundStyle(.secondary)
        .accessibilityHidden(true)
    }
}
