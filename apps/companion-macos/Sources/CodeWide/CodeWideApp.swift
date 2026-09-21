import AppKit
import CodeWideShared
import SwiftUI

@main
@MainActor
struct CodeWideApp: App {
    @StateObject private var runtime: RuntimeConnection
    @StateObject private var updates: UpdateController

    init() {
        let runtime = RuntimeConnection()
        _runtime = StateObject(wrappedValue: runtime)
        _updates = StateObject(wrappedValue: UpdateController(runtime: runtime))
        runtime.start()
    }

    var body: some Scene {
        MenuBarExtra {
            RuntimeMenu(runtime: runtime, updates: updates)
        } label: {
            Image(nsImage: Self.menuBarImage)
                .opacity(runtime.health == nil ? 0.45 : 1)
                .accessibilityLabel("CodeWide")
        }
        .menuBarExtraStyle(.menu)
    }

    private static var menuBarImage: NSImage {
        guard
            let url = Bundle.main.url(
                forResource: "CodeWideMenuBarTemplate",
                withExtension: "png"
            ),
            let image = NSImage(contentsOf: url)
        else {
            return NSImage(systemSymbolName: "bolt.fill", accessibilityDescription: "CodeWide")
                ?? NSImage()
        }
        image.isTemplate = true
        return image
    }
}

private struct RuntimeMenu: View {
    @ObservedObject var runtime: RuntimeConnection
    @ObservedObject var updates: UpdateController

    var body: some View {
        Text("Companion: \(runtime.status)")
        if let health = runtime.health {
            Text("App \(health.appVersion) · Core \(health.coreVersion)")
            Text("PID \(health.processID) · launch \(health.launchCount)")
            if health.updateStatus == "applied",
               let previous = health.updateFromVersion,
               let current = health.updateTargetVersion
            {
                Text("Updated \(previous) → \(current)")
            }
        }
        if let error = runtime.lastError ?? updates.lastError {
            Text(error)
        }
        if runtime.requiresApproval {
            Button("Open Login Items Settings") {
                runtime.openLoginItemsSettings()
            }
        }
        Divider()
        Button(updates.availableVersion.map { "Install \($0)" } ?? "Check for Updates…") {
            updates.checkForUpdates()
        }
        .disabled(!updates.canCheckForUpdates)
        Button("Refresh Runtime") {
            Task {
                await runtime.refresh()
            }
        }
        Divider()
        Button("Quit CodeWide") {
            NSApplication.shared.terminate(nil)
        }
        .keyboardShortcut("q")
    }
}
