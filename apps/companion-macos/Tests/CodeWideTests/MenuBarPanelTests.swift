import AppKit
import Combine
import SwiftUI
import Testing
@testable import CodeWide

/// Real AppKit windows driven by an in-process SwiftUI fixture. These tests
/// cover resize/focus/lifetime, not installed-app Computer Use or glass pixels.
@Suite(.serialized) @MainActor
struct MenuBarPanelTests {
    private static let application: NSApplication = {
        let application = NSApplication.shared
        application.setActivationPolicy(.accessory)
        application.finishLaunching()
        return application
    }()

    @Test func disclosureRemainsAttachedWhenTheStatusItemIsParkedOffscreen() async throws {
        _ = Self.application
        let screen = try #require(NSScreen.main)
        let visibleAnchor = MenuBarAnchor(rect: NSRect(x: screen.visibleFrame.midX, y: screen.visibleFrame.maxY,
                                                      width: 28, height: 24), visibleFrame: screen.visibleFrame)
        var currentAnchor: MenuBarAnchor? = visibleAnchor
        let model = MenuFixtureModel()
        let panel = MenuBarPanel(content: MenuFixture(model: model)) { currentAnchor }
        defer { panel.close() }
        panel.show()
        try await Task.sleep(for: .milliseconds(100))
        let collapsed = panel.window.frame
        #expect(panel.isShown)
        // WindowServer key ownership requires NSApplication.run(), which the
        // Swift Testing driver doesn't run. The standalone AppKit harness
        // checks that separately, including the Cmd-N action.
        #expect(panel.window.firstResponder === panel.window)
        #expect(panel.window.contentView is NSGlassEffectView)
        #expect(!panel.window.hasShadow)
        #expect((panel.window.contentView as? NSGlassEffectView)?.cornerRadius == 22)
        #expect((panel.window.contentView as? NSGlassEffectView)?.focusRingType == NSFocusRingType.none)

        // This is the case a stable NSButton anchor never exercises: the
        // status-item view disappears while the already-open menu changes size.
        currentAnchor = nil
        for index in 0..<8 {
            model.expanded = index.isMultiple(of: 2)
            try await Task.sleep(for: .milliseconds(100))
            #expect(panel.isShown)
            #expect(abs(panel.window.frame.maxY - collapsed.maxY) < 1)
            #expect(abs(panel.window.frame.midX - collapsed.midX) < 1)
            if model.expanded { #expect(panel.window.frame.height > collapsed.height + 80) }
            else { #expect(abs(panel.window.frame.height - collapsed.height) < 1) }
        }
    }

    @Test func mouseOpeningDoesNotFocusActionsButKeyboardOpeningDoes() async throws {
        _ = Self.application
        let screen = try #require(NSScreen.main)
        let anchor = MenuBarAnchor(rect: NSRect(x: screen.visibleFrame.midX, y: screen.visibleFrame.maxY,
                                               width: 28, height: 24), visibleFrame: screen.visibleFrame)
        let panel = MenuBarPanel(content: MenuFixture(model: MenuFixtureModel())) { anchor }
        defer { panel.close() }
        panel.show()
        try await Task.sleep(for: .milliseconds(100))
        #expect(panel.window.firstResponder === panel.window)
        panel.close()
        panel.show(keyboardInitiated: true)
        try await Task.sleep(for: .milliseconds(100))
        #expect(panel.isShown)
        #expect(panel.window.firstResponder !== panel.window)
        #expect(panel.window.firstResponder != nil)
    }

    @Test func escapeAndAQueuedResizeCannotReopenTheMenu() async throws {
        _ = Self.application
        let screen = try #require(NSScreen.main)
        let anchor = MenuBarAnchor(rect: NSRect(x: screen.visibleFrame.midX, y: screen.visibleFrame.maxY,
                                               width: 28, height: 24), visibleFrame: screen.visibleFrame)
        let model = MenuFixtureModel()
        let panel = MenuBarPanel(content: MenuFixture(model: model)) { anchor }
        var closeCount = 0
        panel.didClose = { closeCount += 1 }
        panel.show()
        model.expanded = true
        panel.window.cancelOperation(nil)
        try await Task.sleep(for: .milliseconds(150))
        #expect(!panel.isShown)
        #expect(closeCount == 1)
        panel.show()
        #expect(panel.isShown)
        panel.close()
        #expect(closeCount == 2)
    }

    @Test func anInitiallyHiddenStatusItemDoesNotOpenAtTheScreenOrigin() {
        _ = Self.application
        let panel = MenuBarPanel(content: MenuFixture(model: MenuFixtureModel())) { nil }
        panel.show()
        #expect(!panel.isShown)
    }

    @Test func panelFitsScreenEdgesAndGrowsDownOnAnyDisplay() {
        for screen in [NSRect(x: 0, y: 0, width: 1_024, height: 700),
                       NSRect(x: -1_920, y: 80, width: 1_920, height: 1_000)] {
            for x in [screen.minX, screen.midX, screen.maxX - 28] {
                let anchor = MenuBarAnchor(rect: NSRect(x: x, y: screen.maxY, width: 28, height: 24),
                                           visibleFrame: screen)
                let collapsed = anchor.panelFrame(for: NSSize(width: 360, height: 320))
                for height in [460.0, 2_000.0] {
                    let expanded = anchor.panelFrame(for: NSSize(width: 360, height: height))
                    #expect(expanded.maxY == collapsed.maxY)
                    #expect(expanded.midX == collapsed.midX)
                    #expect(screen.contains(expanded))
                }
            }
        }
    }

    @Test func periodicParentRefreshDoesNotRebuildTheTrackedActionMenu() {
        let stable = CompanionActionMenuIdentity(
            appVersion: "0.4.0",
            runtimeAvailable: true,
            requiresApproval: false,
            profiles: [.init(id: "default", displayName: "Default", isAvailable: true, isSelected: true)],
            relayConfigured: true,
            relayEnabled: true,
            canCheckForUpdates: true,
            isCheckingForUpdates: false,
            actionInProgress: false,
            keepAwakePolicy: KeepAwakePolicy.whilePluggedIn.rawValue,
            keepAwakeStatus: "On battery · sleep allowed",
            launchAtLoginEnabled: true,
            launchAtLoginRequiresApproval: false,
            launchAtLoginChanging: false
        )
        let first = CompanionActionMenu(availableUpdate: nil, darkAppearance: true, identity: stable) {
            Text("First render")
        }
        let refreshed = CompanionActionMenu(availableUpdate: nil, darkAppearance: true, identity: stable) {
            Text("Second render")
        }
        #expect(first == refreshed)

        let changed = CompanionActionMenu(
            availableUpdate: nil,
            darkAppearance: true,
            identity: CompanionActionMenuIdentity(
                appVersion: stable.appVersion,
                runtimeAvailable: stable.runtimeAvailable,
                requiresApproval: stable.requiresApproval,
                profiles: stable.profiles,
                relayConfigured: stable.relayConfigured,
                relayEnabled: stable.relayEnabled,
                canCheckForUpdates: stable.canCheckForUpdates,
                isCheckingForUpdates: stable.isCheckingForUpdates,
                actionInProgress: stable.actionInProgress,
                keepAwakePolicy: KeepAwakePolicy.always.rawValue,
                keepAwakeStatus: "Preventing idle sleep",
                launchAtLoginEnabled: stable.launchAtLoginEnabled,
                launchAtLoginRequiresApproval: stable.launchAtLoginRequiresApproval,
                launchAtLoginChanging: stable.launchAtLoginChanging
            )
        ) {
            Text("Third render")
        }
        #expect(first != changed)
    }
}

@MainActor private final class MenuFixtureModel: ObservableObject {
    @Published var expanded = false
}

private struct MenuFixture: View {
    @ObservedObject var model: MenuFixtureModel

    var body: some View {
        CompanionMenuView(snapshot: CompanionMenuSnapshot(connection: .connected, profileName: "Default",
                            serverVersion: "0.157.0", appVersion: "0.4.0", coreVersion: "0.4.0",
                            address: "192.0.2.1:8767"), primaryAction: {}, revokeDevice: { _ in },
                          initiallyShowsDetails: model.expanded, moreActions: { Button("Test") {} })
            .id(model.expanded)
    }
}
