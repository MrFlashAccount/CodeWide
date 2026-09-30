import AppKit
import Combine
import SwiftUI

/// Only this fixture application's keyboard-navigation input is overridden.
/// No defaults write, accessibility permission or host preference is required.
@MainActor final class HarnessApplication: NSApplication {
    static var keyboardNavigationEnabled = false
    override var isFullKeyboardAccessEnabled: Bool { Self.keyboardNavigationEnabled }
}

/// A separate AppKit application exercising production fixture views/windows.
/// No helpers, user data, global input injection or installed-app automation.
@main @MainActor enum MenuPanelHarness {
    static func main() {
        precondition(CommandLine.arguments.count == 3)
        let mode = CommandLine.arguments[2]
        precondition(mode == "--keyboard-navigation=on" || mode == "--keyboard-navigation=off")
        HarnessApplication.keyboardNavigationEnabled = mode == "--keyboard-navigation=on"
        let app = HarnessApplication.shared
        precondition(app is HarnessApplication)
        let delegate = HarnessDelegate()
        app.delegate = delegate
        app.setActivationPolicy(.accessory)
        withExtendedLifetime(delegate) { app.run() }
    }
}

private struct HarnessReport: Encodable {
    let keyboardNavigationEnabled: Bool
    var checks: [String: Bool] = [:]
    var diagnostics: [String: String] = [:]
    var failure: String?
}

private enum HarnessFailure: Error {
    case missingScreen
    case anchorMoved
}

@MainActor final class HarnessDelegate: NSObject, NSApplicationDelegate {
    private var trackedMenu: NSMenu?
    private var panel: MenuBarPanel?
    private var report = HarnessReport(keyboardNavigationEnabled: HarnessApplication.keyboardNavigationEnabled)

    func applicationDidFinishLaunching(_ notification: Notification) {
        Task { await exercise() }
    }

    private func check(_ name: String, _ condition: () -> Bool) async throws {
        // An absent/failed stage cannot be mistaken for a passed empty report.
        report.checks[name] = false
        report.diagnostics["stage"] = name
        try await waitForCondition(condition)
        report.checks[name] = true
    }

    private func exercise() async {
        do {
            try await exercisePanel()
        } catch {
            report.failure = String(reflecting: error)
            report.diagnostics["applicationRunning"] = String(NSApp.isRunning)
            report.diagnostics["keyboardNavigationEnabled"] = String(NSApp.isFullKeyboardAccessEnabled)
            if let panel {
                report.diagnostics["panelShown"] = String(panel.isShown)
                report.diagnostics["keyWindow"] = String(panel.window.isKeyWindow)
                report.diagnostics["height"] = String(Double(panel.window.frame.height))
                report.diagnostics["firstResponder"] = panel.window.firstResponder.map {
                    String(reflecting: type(of: $0))
                } ?? "nil"
            }
        }
        panel?.close()
        do {
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            try encoder.encode(report).write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
        } catch {
            print("Cannot write fixture report: \(error)")
            exit(1)
        }
        NSApp.terminate(nil)
    }

    private func exercisePanel() async throws {
        guard let screen = NSScreen.main else { throw HarnessFailure.missingScreen }
        let anchor = MenuBarAnchor(rect: NSRect(x: screen.visibleFrame.midX, y: screen.visibleFrame.maxY,
                                               width: 28, height: 24), visibleFrame: screen.visibleFrame)
        var currentAnchor: MenuBarAnchor? = anchor
        let model = HarnessModel()
        let panel = MenuBarPanel(content: HarnessMenu(model: model)) { currentAnchor }
        self.panel = panel
        var closeCount = 0
        panel.didClose = { closeCount += 1 }
        panel.show()
        try await check("applicationRunning") { NSApp.isRunning }
        try await check("keyboardNavigationMatchesFixture") {
            NSApp.isFullKeyboardAccessEnabled == HarnessApplication.keyboardNavigationEnabled
        }
        try await check("keyWindow") { panel.isShown && panel.window.isKeyWindow }
        try await check("mouseOpeningHasNoControlFocus") { panel.window.firstResponder === panel.window }
        try await check("roundedGlassHasNoSquareWindowChrome") {
            let glass = panel.window.contentView as? NSGlassEffectView
            return glass?.cornerRadius == 22 && glass?.focusRingType == NSFocusRingType.none
                && panel.window.backgroundColor.alphaComponent == 0
                && !panel.window.isOpaque && !panel.window.hasShadow
        }

        let initial = panel.window.frame
        report.diagnostics["collapsedHeight"] = String(Double(initial.height))
        currentAnchor = nil
        report.checks["hiddenAnchorStable"] = false
        report.checks["disclosureChangesHeight"] = false
        for index in 0..<8 {
            let expanded = index.isMultiple(of: 2)
            model.expanded = expanded
            report.diagnostics["stage"] = "disclosure \(index), expanded=\(expanded)"
            // Read the actual new layout; do not retry the disclosure action.
            try await waitForCondition {
                expanded ? panel.window.frame.height > initial.height + 80
                    : abs(panel.window.frame.height - initial.height) < 1
            }
            guard panel.isShown, abs(panel.window.frame.maxY - initial.maxY) < 1,
                  abs(panel.window.frame.midX - initial.midX) < 1 else {
                throw HarnessFailure.anchorMoved
            }
        }
        report.checks["hiddenAnchorStable"] = true
        report.checks["disclosureChangesHeight"] = true

        let menu = NSMenu(title: "Fixture actions")
        trackedMenu = menu
        menu.addItem(withTitle: "Fixture action", action: nil, keyEquivalent: "")
        // This timer supplies the fixture's cancel input while popUp runs its
        // nested event-tracking loop. It is not proof that restoration finished.
        let cancel = Timer(timeInterval: 0.15, repeats: false) { [weak self] _ in
            MainActor.assumeIsolated { self?.trackedMenu?.cancelTracking() }
        }
        RunLoop.main.add(cancel, forMode: .eventTracking)
        menu.popUp(positioning: nil, at: NSPoint(x: 330, y: 280), in: panel.window.contentView)
        cancel.invalidate()
        trackedMenu = nil
        try await check("nativeActionMenuKeepsPanelOpen") { panel.isShown }
        try await check("nativeActionMenuRestoresKeyWindow") { panel.window.isKeyWindow }

        let key = NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: .command,
                                  timestamp: 0, windowNumber: panel.window.windowNumber, context: nil,
                                  characters: "n", charactersIgnoringModifiers: "n", isARepeat: false, keyCode: 45)!
        _ = panel.window.performKeyEquivalent(with: key)
        try await check("primaryShortcutInvoked") { model.primaryActions == 1 }
        panel.close()
        currentAnchor = anchor
        panel.show(keyboardInitiated: true)
        try await check("keyboardOpeningMatchesNavigationMode") {
            guard panel.isShown && panel.window.isKeyWindow else { return false }
            if HarnessApplication.keyboardNavigationEnabled {
                return panel.window.firstResponder !== panel.window && panel.window.firstResponder != nil
            }
            // macOS buttons aren't Tab targets when keyboard navigation is off.
            // The panel still owns keyboard commands (Cmd-N was checked above).
            return panel.window.firstResponder === panel.window
        }

        let beforeEscape = closeCount
        model.expanded = true
        panel.window.cancelOperation(nil)
        // Yield to queued main-thread work. Reopening below must also consume
        // the changed geometry; a fixed pause is not synchronization.
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            DispatchQueue.main.async { continuation.resume() }
        }
        try await check("escapeAndQueuedResizeDoNotReopenPanel") {
            !panel.isShown && closeCount == beforeEscape + 1
        }
        panel.show()
        try await check("explicitReopenUsesUpdatedLayout") {
            panel.isShown && panel.window.isKeyWindow && panel.window.frame.height > initial.height + 80
                && closeCount == beforeEscape + 1
        }
        panel.close()
        try await check("oneCloseCallbackPerPresentation") { closeCount == beforeEscape + 2 }

        panel.show()
        let outside = HarnessOutsideWindow(contentRect: NSRect(x: 100, y: 100, width: 10, height: 10),
                               styleMask: .borderless, backing: .buffered, defer: false)
        outside.isReleasedWhenClosed = false
        let click = NSEvent.mouseEvent(with: .leftMouseDown, location: NSPoint(x: 2, y: 2),
                                       modifierFlags: [], timestamp: 0, windowNumber: outside.windowNumber,
                                       context: nil, eventNumber: 1, clickCount: 1, pressure: 1)!
        NSApp.sendEvent(click)
        try await check("outsideClickClosesPanel") { !panel.isShown }
        outside.close()
    }
}

@MainActor final class HarnessOutsideWindow: NSWindow {
    // Don't enter mouse-down/up tracking in the empty outside-click fixture.
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
