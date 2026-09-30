import AppKit
import Combine
import SwiftUI

/// A separate AppKit application exercising only fixture views and windows.
/// No helpers, user data, global input injection or installed-app automation.
@main @MainActor enum MenuPanelHarness {
    static func main() {
        let app = NSApplication.shared
        let delegate = HarnessDelegate()
        app.delegate = delegate
        app.setActivationPolicy(.accessory)
        withExtendedLifetime(delegate) { app.run() }
    }
}

@MainActor final class HarnessDelegate: NSObject, NSApplicationDelegate {
    private var trackedMenu: NSMenu?

    func applicationDidFinishLaunching(_ notification: Notification) {
        Task { await exercise() }
    }

    private func exercise() async {
        var result: [String: Any] = [:]
        let screen = NSScreen.main!
        let anchor = MenuBarAnchor(rect: NSRect(x: screen.visibleFrame.midX, y: screen.visibleFrame.maxY,
                                               width: 28, height: 24), visibleFrame: screen.visibleFrame)
        var currentAnchor: MenuBarAnchor? = anchor
        let model = HarnessModel()
        let panel = MenuBarPanel(content: HarnessMenu(model: model)) { currentAnchor }
        panel.show()
        try? await Task.sleep(for: .milliseconds(150))
        result["applicationRunning"] = NSApp.isRunning
        result["keyWindow"] = panel.window.isKeyWindow
        result["mouseOpeningHasNoControlFocus"] = panel.window.firstResponder === panel.window
        let glass = panel.window.contentView as? NSGlassEffectView
        result["roundedGlassHasNoSquareWindowChrome"] = glass?.cornerRadius == 22
            && glass?.focusRingType == NSFocusRingType.none
            && panel.window.backgroundColor.alphaComponent == 0
            && !panel.window.isOpaque
            && !panel.window.hasShadow
        let initial = panel.window.frame
        currentAnchor = nil
        var anchorsStable = true
        for expanded in [true, false, true, false] {
            model.expanded = expanded
            try? await Task.sleep(for: .milliseconds(80))
            anchorsStable = anchorsStable && panel.isShown
                && abs(panel.window.frame.maxY - initial.maxY) < 1
                && abs(panel.window.frame.midX - initial.midX) < 1
        }
        result["hiddenAnchorStable"] = anchorsStable

        let menu = NSMenu(title: "Fixture actions")
        trackedMenu = menu
        menu.addItem(withTitle: "Fixture action", action: nil, keyEquivalent: "")
        let cancel = Timer(timeInterval: 0.15, repeats: false) { [weak self] _ in
            MainActor.assumeIsolated { self?.trackedMenu?.cancelTracking() }
        }
        RunLoop.main.add(cancel, forMode: .eventTracking)
        menu.popUp(positioning: nil, at: NSPoint(x: 330, y: 280), in: panel.window.contentView)
        cancel.invalidate()
        trackedMenu = nil
        try? await Task.sleep(for: .milliseconds(100))
        result["nativeActionMenuKeepsPanelOpen"] = panel.isShown
        result["nativeActionMenuRestoresKeyWindow"] = panel.window.isKeyWindow

        let key = NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: .command,
                                  timestamp: 0, windowNumber: panel.window.windowNumber, context: nil,
                                  characters: "n", charactersIgnoringModifiers: "n", isARepeat: false, keyCode: 45)!
        _ = panel.window.performKeyEquivalent(with: key)
        result["primaryShortcutInvoked"] = model.primaryActions == 1
        panel.close()
        currentAnchor = anchor
        panel.show(keyboardInitiated: true)
        try? await Task.sleep(for: .milliseconds(100))
        result["keyboardOpeningHasControlFocus"] = panel.window.firstResponder !== panel.window && panel.window.firstResponder != nil
        panel.window.cancelOperation(nil)
        result["escapeClosesPanel"] = !panel.isShown

        panel.show()
        let outside = HarnessOutsideWindow(contentRect: NSRect(x: 100, y: 100, width: 10, height: 10),
                               styleMask: .borderless, backing: .buffered, defer: false)
        outside.isReleasedWhenClosed = false
        let click = NSEvent.mouseEvent(with: .leftMouseDown, location: NSPoint(x: 2, y: 2),
                                       modifierFlags: [], timestamp: 0, windowNumber: outside.windowNumber,
                                       context: nil, eventNumber: 1, clickCount: 1, pressure: 1)!
        NSApp.sendEvent(click)
        result["outsideClickClosesPanel"] = !panel.isShown
        outside.close()

        let data = try! JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys])
        try! data.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
        NSApp.terminate(nil)
    }
}

@MainActor final class HarnessOutsideWindow: NSWindow {
    // The test only needs application event monitors to see an outside click;
    // don't enter AppKit's mouse-down/up tracking loop in this empty fixture.
    override func sendEvent(_ event: NSEvent) {}
}

@MainActor final class HarnessModel: ObservableObject {
    @Published var expanded = false
    var primaryActions = 0
}

struct HarnessMenu: View {
    @ObservedObject var model: HarnessModel
    var body: some View {
        CompanionMenuView(snapshot: CompanionMenuSnapshot(connection: .connected, profileName: "Default",
                            serverVersion: "0.157.0", appVersion: "0.4.0", coreVersion: "0.4.0",
                            address: "192.0.2.1:8767"), primaryAction: { model.primaryActions += 1 }, revokeDevice: { _ in },
                          initiallyShowsDetails: model.expanded, moreActions: { Button("Fixture action") {} })
            .id(model.expanded)
    }
}
