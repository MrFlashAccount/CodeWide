import AppKit
import Combine
import SwiftUI

@MainActor
final class OnboardingWindowController: NSObject, ObservableObject, NSWindowDelegate {
    private static let completionKey = "CodeWideDidCompleteOnboarding.v1"

    private let runtime: RuntimeConnection
    private let showRelaySetup: @MainActor () -> Void
    private var window: NSWindow?

    init(runtime: RuntimeConnection, showRelaySetup: @escaping @MainActor () -> Void) {
        self.runtime = runtime
        self.showRelaySetup = showRelaySetup
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
            showRelaySetup: showRelaySetup,
            finish: { [weak self] in self?.complete() }
        )
        let window = Self.makeWindow(content: rootView)
        window.center()
        window.delegate = self
        self.window = window
        window.makeKeyAndOrderFront(nil)
        NSApplication.shared.activate(ignoringOtherApps: true)
        if NSApplication.shared.currentEvent?.type != .keyDown { window.makeFirstResponder(nil) }
    }

    /// The system owns the titlebar, safe area and sidebar glass. Wrapping a
    /// transparent titled window in a second rounded glass surface splits them.
    static func makeWindow<Content: View>(content: Content) -> NSWindow {
        let host = NSHostingController(rootView: content)
        host.sceneBridgingOptions = [.title, .toolbars]
        let window = NSWindow(contentViewController: host)
        window.title = "Set Up CodeWide"
        window.styleMask = [.titled, .closable, .resizable, .miniaturizable, .fullSizeContentView]
        window.titleVisibility = .visible
        window.toolbar = NSToolbar(identifier: "CodeWide.Setup")
        window.toolbarStyle = .unifiedCompact
        window.isReleasedWhenClosed = false
        window.setContentSize(NSSize(width: 680, height: 480))
        window.contentMinSize = NSSize(width: 640, height: 440)
        return window
    }

    func windowWillClose(_ notification: Notification) {
        window = nil
    }

    private func complete() {
        UserDefaults.standard.set(true, forKey: Self.completionKey)
        window?.close()
    }
}
