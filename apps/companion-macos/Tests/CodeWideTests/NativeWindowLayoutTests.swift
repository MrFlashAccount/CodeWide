import AppKit
import CodeWideShared
import SwiftUI
import Testing
@testable import CodeWide

/// Exercises real AppKit geometry without showing a window or starting services.
/// It is not a Computer Use or backdrop-composition test.
@Suite(.serialized) @MainActor
struct NativeWindowLayoutTests {
    @Test(arguments: SetupStep.allCases, [false, true])
    func setupKeepsSystemWindowControlsInsideTheFrameAndAboveContent(step: SetupStep, dark: Bool) throws {
        _ = NSApplication.shared
        let profile = AppServerPayload(id: "default", displayName: "Default", codexHome: "/fixture",
                                       state: .available(version: "0.157.0"), selected: true)
        let endpoint = "wss://192.0.2.1:8767/v1/sync"
        let snapshot = SetupSnapshot(step: step, macState: .ready, profiles: [profile],
            endpoints: [endpoint], selectedEndpoint: endpoint,
            pairing: PairingPayload(link: "codewide://pair?fixture=not-a-credential",
                                    expiresAtUnixMilliseconds: UInt64(Date().timeIntervalSince1970 * 1_000) + 60_000),
            hasChosenConnection: true)
        let window = OnboardingWindowController.makeWindow(content: SetupView(snapshot: snapshot, actions: SetupActions())
            .environment(\.colorScheme, dark ? .dark : .light))
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        defer { window.close() }
        for size in [NSSize(width: 640, height: 440), NSSize(width: 680, height: 480), NSSize(width: 840, height: 620)] {
            window.setContentSize(size)
            window.contentView?.layoutSubtreeIfNeeded()
            for kind: NSWindow.ButtonType in [.closeButton, .miniaturizeButton, .zoomButton] {
                let button = try #require(window.standardWindowButton(kind))
                let rect = button.convert(button.bounds, to: nil)
                #expect(rect.minX >= 0 && rect.maxX <= window.frame.width)
                #expect(rect.maxY <= window.frame.height)
                #expect(rect.minY >= window.contentLayoutRect.maxY)
            }
            #expect(window.contentLayoutRect.width >= 640)
            #expect(window.contentLayoutRect.height >= 400)
        }
        #expect(window.backgroundColor.alphaComponent == 1)
    }

    @Test func nativePanelMeasuresBothDisclosureStatesBeforePresentation() {
        _ = NSApplication.shared
        let snapshot = CompanionMenuSnapshot(connection: .connected, profileName: "Default",
                                              serverVersion: "0.157.0", appVersion: "0.4.0",
                                              coreVersion: "0.4.0", address: "192.0.2.1:8767")
        let collapsed = MenuBarPanel(content: CompanionMenuView(
            snapshot: snapshot, primaryAction: {}, revokeDevice: { _ in }, moreActions: { EmptyView() }), anchorProvider: { nil })
        let expanded = MenuBarPanel(content: CompanionMenuView(
            snapshot: snapshot, primaryAction: {}, revokeDevice: { _ in }, initiallyShowsDetails: true,
            moreActions: { EmptyView() }), anchorProvider: { nil })
        #expect(abs(collapsed.contentSize.width - 360) < 1)
        #expect(abs(expanded.contentSize.width - 360) < 1)
        #expect(collapsed.contentSize.height > 200)
        #expect(expanded.contentSize.height > collapsed.contentSize.height)
        #expect(expanded.contentSize.height < 700)
    }

    @Test(arguments: [false, true])
    func pairingUsesCompactNativeWindowChromeInBothAppearances(dark: Bool) throws {
        _ = NSApplication.shared
        let runtime = RuntimeConnection(reportsUpdateHealth: false, registration: nil)
        let pairing = PairingPayload(
            link: "codewide://pair?fixture=not-a-credential",
            expiresAtUnixMilliseconds: UInt64(Date().timeIntervalSince1970 * 1_000) + 60_000
        )
        let window = CompanionDialogController.makePairingWindow(
            content: PairingDialog(runtime: runtime, pairing: pairing, done: {})
                .environment(\.colorScheme, dark ? .dark : .light)
        )
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        defer { window.close() }
        window.contentView?.layoutSubtreeIfNeeded()

        #expect(window.title == "Connect Your Phone")
        #expect(window.styleMask.contains(.titled))
        #expect(window.styleMask.contains(.fullSizeContentView))
        #expect(!window.styleMask.contains(.resizable))
        #expect(window.toolbarStyle == .unifiedCompact)
        #expect(abs(window.contentView!.frame.width - PairingDialogLayout.contentSize.width) < 1)
        #expect(abs(window.contentView!.frame.height - PairingDialogLayout.contentSize.height) < 1)

        for kind: NSWindow.ButtonType in [.closeButton, .miniaturizeButton, .zoomButton] {
            guard let button = window.standardWindowButton(kind) else { continue }
            let rect = button.convert(button.bounds, to: nil)
            #expect(rect.minX >= 0 && rect.maxX <= window.frame.width)
            #expect(rect.minY >= window.contentLayoutRect.maxY)
            #expect(rect.maxY <= window.frame.height)
        }
    }
}
