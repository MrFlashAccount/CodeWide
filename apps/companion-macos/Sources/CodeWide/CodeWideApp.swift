import AppKit
import Combine
import SwiftUI

@main
@MainActor
final class CodeWideApp: NSObject, NSApplicationDelegate {
    private var menuBar: CompanionMenuBarController?
    private var keepAwake: KeepAwakeController?
    private var launchAtLogin: LaunchAtLoginController?

    static func main() {
        let application = NSApplication.shared
        let delegate = CodeWideApp()
        application.delegate = delegate
        application.setActivationPolicy(.accessory)
        withExtendedLifetime(delegate) { application.run() }
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        installApplicationMenu()
        let runtime = RuntimeConnection()
        let updates = UpdateController(runtime: runtime)
        let dialogs = CompanionDialogController(runtime: runtime)
        let keepAwake = KeepAwakeController()
        let launchAtLogin = LaunchAtLoginController()
        self.keepAwake = keepAwake
        self.launchAtLogin = launchAtLogin
        let onboarding = OnboardingWindowController(runtime: runtime, showRelaySetup: {
            dialogs.showRelaySetup()
        })
        menuBar = CompanionMenuBarController(runtime: runtime, updates: updates,
                                             onboarding: onboarding, dialogs: dialogs,
                                             keepAwake: keepAwake,
                                             launchAtLogin: launchAtLogin)
        runtime.start()
        onboarding.showIfNeeded()
    }

    func applicationWillTerminate(_ notification: Notification) {
        keepAwake?.stop()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    /// Preserve standard text-field shortcuts in the native Relay and Setup windows.
    private func installApplicationMenu() {
        let menu = NSMenu()
        let appItem = NSMenuItem()
        let appMenu = NSMenu(title: "CodeWide")
        appMenu.addItem(withTitle: "Quit CodeWide", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        menu.addItem(appItem)
        let editItem = NSMenuItem()
        let editMenu = NSMenu(title: "Edit")
        for (title, action, key) in [("Undo", "undo:", "z"), ("Cut", "cut:", "x"),
                                      ("Copy", "copy:", "c"), ("Paste", "paste:", "v"),
                                      ("Select All", "selectAll:", "a")] {
            editMenu.addItem(withTitle: title, action: Selector(action), keyEquivalent: key)
        }
        editItem.submenu = editMenu
        menu.addItem(editItem)
        NSApplication.shared.mainMenu = menu
    }
}

@MainActor
final class CompanionMenuBarController: NSObject {
    private let statusItem: NSStatusItem
    private let panel: MenuBarPanel
    private let runtime: RuntimeConnection
    private var healthObservation: AnyCancellable?

    init(runtime: RuntimeConnection, updates: UpdateController,
         onboarding: OnboardingWindowController, dialogs: CompanionDialogController,
         keepAwake: KeepAwakeController, launchAtLogin: LaunchAtLoginController) {
        self.runtime = runtime
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        let button = statusItem.button
        panel = MenuBarPanel(content: CompanionPanel(runtime: runtime, updates: updates,
                                                      onboarding: onboarding, dialogs: dialogs,
                                                      keepAwake: keepAwake,
                                                      launchAtLogin: launchAtLogin)) { [weak button] in
            button.flatMap { MenuBarAnchor.read(from: $0) }
        }
        super.init()
        statusItem.autosaveName = "CodeWide"
        if let button = statusItem.button {
            button.image = Self.menuBarImage
            button.setAccessibilityLabel("CodeWide")
            button.toolTip = "CodeWide"
            button.target = self
            button.action = #selector(togglePopover)
            healthObservation = runtime.$health.sink { [weak button] health in
                button?.alphaValue = health == nil ? 0.45 : 1
            }
        }
        panel.didClose = { [weak button] in button?.highlight(false) }
    }

    @objc private func togglePopover() {
        if panel.isShown { panel.close() }
        else if let button = statusItem.button {
            let keyboardInitiated = NSApplication.shared.currentEvent?.type == .keyDown
            panel.show(keyboardInitiated: keyboardInitiated)
            button.highlight(panel.isShown)
        }
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
