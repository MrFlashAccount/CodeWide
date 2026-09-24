import AppKit
import Combine
import SwiftUI

@MainActor
final class OnboardingWindowController: NSObject, ObservableObject, NSWindowDelegate {
    private static let completionKey = "CodeWideDidCompleteOnboarding.v1"

    private let runtime: RuntimeConnection
    private var window: NSWindow?

    init(runtime: RuntimeConnection) {
        self.runtime = runtime
    }

    func showIfNeeded() {
        guard !UserDefaults.standard.bool(forKey: Self.completionKey) else {
            return
        }
        show()
    }

    func show() {
        if let window {
            window.makeKeyAndOrderFront(nil)
            NSApplication.shared.activate(ignoringOtherApps: true)
            return
        }

        let rootView = OnboardingFlow(
            runtime: runtime,
            finish: { [weak self] in self?.complete() }
        )
        let window = NSWindow(contentViewController: NSHostingController(rootView: rootView))
        window.title = "Set Up CodeWide"
        window.styleMask = [.titled, .closable, .fullSizeContentView]
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.isMovableByWindowBackground = true
        window.isOpaque = true
        window.backgroundColor = .windowBackgroundColor
        window.isReleasedWhenClosed = false
        window.setContentSize(NSSize(width: 660, height: 470))
        window.minSize = NSSize(width: 620, height: 430)
        window.center()
        window.delegate = self
        self.window = window
        window.makeKeyAndOrderFront(nil)
        NSApplication.shared.activate(ignoringOtherApps: true)
    }

    func windowWillClose(_ notification: Notification) {
        window = nil
    }

    private func complete() {
        UserDefaults.standard.set(true, forKey: Self.completionKey)
        window?.close()
    }
}
