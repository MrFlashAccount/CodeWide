import AppKit
import SwiftUI

/// A visible status-item position, independent of its temporary AppKit window.
/// Menu-bar managers can park that window offscreen after a click. Retain the
/// last visible anchor for the current presentation instead of following it.
struct MenuBarAnchor {
    let rect: NSRect
    let visibleFrame: NSRect

    @MainActor static func read(from button: NSView) -> Self? {
        guard let window = button.window, window.isVisible else { return nil }
        let rect = window.convertToScreen(button.convert(button.bounds, to: nil))
        guard rect.width > 0, rect.height > 0,
              let screen = NSScreen.screens.first(where: { $0.frame.contains(NSPoint(x: rect.midX, y: rect.midY)) })
        else { return nil }
        return Self(rect: rect, visibleFrame: screen.visibleFrame)
    }

    func panelFrame(for content: NSSize) -> NSRect {
        let margin: CGFloat = 8
        let top = min(rect.minY - 6, visibleFrame.maxY - 6)
        let width = min(content.width, visibleFrame.width - margin * 2)
        let height = min(content.height, max(1, top - visibleFrame.minY - margin))
        let x = min(max(rect.midX - width / 2, visibleFrame.minX + margin),
                    visibleFrame.maxX - margin - width)
        return NSRect(x: x, y: top - height, width: width, height: height)
    }
}

@MainActor
final class MenuBarPanel: NSObject, NSWindowDelegate {
    private(set) var window: NSPanel
    private let host: NSHostingController<AnyView>
    private let scrollView = NSScrollView()
    private let anchorProvider: () -> MenuBarAnchor?
    private var anchor: MenuBarAnchor?
    private var measuredSize: NSSize = .zero
    private var pendingSize: NSSize?
    private var isClosing = false
    private var trackingMenus = 0
    private var localMonitor: Any?
    private var globalMonitor: Any?
    private var observations: [NSObjectProtocol] = []
    var didClose: () -> Void = {}

    var isShown: Bool { window.isVisible }
    var contentSize: NSSize { measuredSize }

    init<Content: View>(content: Content, anchorProvider: @escaping () -> MenuBarAnchor?) {
        self.anchorProvider = anchorProvider
        let sizes = MenuContentSizeObserver()
        host = NSHostingController(rootView: AnyView(content.onGeometryChange(for: CGSize.self) {
            $0.size
        } action: { sizes.changed?($0) }))
        // Only this presenter may resize the window. SwiftUI reports the full
        // document size; an NSScrollView handles unusually long notices/lists.
        host.sizingOptions = []
        window = MenuPanelWindow(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel],
                                 backing: .buffered, defer: false)
        super.init()
        window.isReleasedWhenClosed = false
        window.isOpaque = false
        window.backgroundColor = .clear
        // NSWindow computes this shadow from the rectangular window surface,
        // not from NSGlassEffectView's rounded glass. That leaves a second,
        // square outline around the native glass on screen.
        window.hasShadow = false
        window.hidesOnDeactivate = false
        window.level = .popUpMenu
        window.collectionBehavior = [.transient, .fullScreenAuxiliary]
        window.animationBehavior = .none
        window.delegate = self
        (window as? MenuPanelWindow)?.dismiss = { [weak self] in self?.close() }

        scrollView.drawsBackground = false
        scrollView.borderType = .noBorder
        scrollView.focusRingType = .none
        scrollView.hasVerticalScroller = true
        scrollView.autohidesScrollers = true
        scrollView.scrollerStyle = .overlay
        scrollView.horizontalScrollElasticity = .none
        scrollView.verticalScrollElasticity = .none
        scrollView.documentView = host.view
        let glass = NSGlassEffectView()
        glass.style = .regular
        glass.cornerRadius = 22
        glass.focusRingType = .none
        glass.contentView = scrollView
        window.contentView = glass
        sizes.changed = { [weak self] size in self?.scheduleResize(to: size) }
        resize(to: host.sizeThatFits(in: NSSize(width: 360, height: 2_000)))
    }

    func show(keyboardInitiated: Bool = false) {
        guard !isShown, let visibleAnchor = anchorProvider() else { return }
        anchor = visibleAnchor
        position()
        window.makeKeyAndOrderFront(nil)
        if keyboardInitiated { window.selectNextKeyView(nil) }
        else { window.makeFirstResponder(nil) }
        installDismissalHandlers()
    }

    func close() {
        guard isShown, !isClosing else { return }
        isClosing = true
        defer { isClosing = false }
        removeDismissalHandlers()
        window.orderOut(nil)
        anchor = nil
        didClose()
    }

    func windowDidResignKey(_ notification: Notification) {
        // An NSMenu temporarily takes key ownership while tracking. Closing its
        // parent here would also dismiss the ellipsis menu before its action.
        guard trackingMenus == 0 else { return }
        if let event = NSApplication.shared.currentEvent, isStatusItemClick(event) { return }
        close()
    }

    private func scheduleResize(to size: NSSize) {
        guard size.width.isFinite, size.height.isFinite, size.width > 0, size.height > 0 else { return }
        let alreadyScheduled = pendingSize != nil
        pendingSize = size
        guard !alreadyScheduled else { return }
        DispatchQueue.main.async { [weak self] in
            guard let self, let size = self.pendingSize else { return }
            self.pendingSize = nil
            self.resize(to: size)
        }
    }

    private func resize(to size: NSSize) {
        let size = NSSize(width: 360, height: ceil(size.height))
        guard size != measuredSize else { return }
        measuredSize = size
        host.view.setFrameSize(size)
        if isShown {
            // A hidden status item is not a new anchor. Keep the last visible
            // one, including across repeated disclosure expand/collapse.
            if let visibleAnchor = anchorProvider() { anchor = visibleAnchor }
            position()
        }
    }

    private func position() {
        guard let anchor else { return }
        window.setFrame(anchor.panelFrame(for: measuredSize), display: true, animate: false)
        scrollView.frame = window.contentView?.bounds ?? .zero
        window.invalidateShadow()
    }

    private func installDismissalHandlers() {
        let clicks: NSEvent.EventTypeMask = [.leftMouseDown, .rightMouseDown, .otherMouseDown]
        localMonitor = NSEvent.addLocalMonitorForEvents(matching: clicks) { [weak self] event in
            MainActor.assumeIsolated {
                guard let self else { return }
                // Let the status-item action toggle the panel exactly once.
                // Native menus track their own events and retain keyboard focus.
                if self.trackingMenus == 0, event.window !== self.window,
                   event.window?.parent !== self.window,
                   !self.isStatusItemClick(event) {
                    self.close()
                }
            }
            return event
        }
        globalMonitor = NSEvent.addGlobalMonitorForEvents(matching: clicks) { [weak self] _ in
            MainActor.assumeIsolated { self?.close() }
        }
        observations.append(NotificationCenter.default.addObserver(
            forName: NSMenu.didBeginTrackingNotification, object: nil, queue: .main
        ) { [weak self] _ in MainActor.assumeIsolated { self?.trackingMenus += 1 } })
        observations.append(NotificationCenter.default.addObserver(
            forName: NSMenu.didEndTrackingNotification, object: nil, queue: .main
        ) { [weak self] _ in MainActor.assumeIsolated {
            guard let self else { return }
            self.trackingMenus = max(0, self.trackingMenus - 1)
            // A selected menu action may have opened Setup or another dialog.
            // Let AppKit finish restoring key ownership before dismissing the
            // panel; cancellation should return focus to this same panel.
            DispatchQueue.main.async { [weak self] in
                guard let self, self.isShown, self.trackingMenus == 0,
                      !self.window.isKeyWindow else { return }
                self.close()
            }
        } })
        observations.append(NotificationCenter.default.addObserver(
            forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main
        ) { [weak self] _ in MainActor.assumeIsolated { self?.close() } })
        observations.append(NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.activeSpaceDidChangeNotification, object: nil, queue: .main
        ) { [weak self] _ in MainActor.assumeIsolated { self?.close() } })
    }

    private func removeDismissalHandlers() {
        if let localMonitor { NSEvent.removeMonitor(localMonitor) }
        if let globalMonitor { NSEvent.removeMonitor(globalMonitor) }
        localMonitor = nil
        globalMonitor = nil
        for observation in observations {
            NotificationCenter.default.removeObserver(observation)
            NSWorkspace.shared.notificationCenter.removeObserver(observation)
        }
        observations.removeAll()
        trackingMenus = 0
    }

    private func isStatusItemClick(_ event: NSEvent) -> Bool {
        guard [.leftMouseDown, .leftMouseUp, .rightMouseDown, .rightMouseUp, .otherMouseDown, .otherMouseUp].contains(event.type),
              let rect = anchorProvider()?.rect else { return false }
        let point = event.window?.convertPoint(toScreen: event.locationInWindow) ?? NSEvent.mouseLocation
        return rect.contains(point)
    }
}

@MainActor private final class MenuContentSizeObserver {
    var changed: ((CGSize) -> Void)?
}

@MainActor private final class MenuPanelWindow: NSPanel {
    var dismiss: () -> Void = {}
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
    override func cancelOperation(_ sender: Any?) { dismiss() }
}
