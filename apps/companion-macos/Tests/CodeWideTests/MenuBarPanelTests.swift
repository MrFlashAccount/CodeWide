import AppKit
import SwiftUI
import Testing
@testable import CodeWide

/// Synchronous presentation/geometry contracts. Native disclosure, focus and
/// close/resize ordering run in MenuBarHarness with NSApplication.run().
@Suite(.serialized) @MainActor
struct MenuBarPanelTests {
    private static let application: NSApplication = {
        let application = NSApplication.shared
        application.setActivationPolicy(.accessory)
        application.finishLaunching()
        return application
    }()

    @Test func anInitiallyHiddenStatusItemDoesNotOpenAtTheScreenOrigin() {
        _ = Self.application
        let panel = MenuBarPanel(content: EmptyView()) { nil }
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
