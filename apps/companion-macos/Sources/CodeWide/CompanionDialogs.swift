import AppKit
import CodeWideShared
import Combine
import SwiftUI

@MainActor
final class CompanionDialogController: NSObject, ObservableObject, NSWindowDelegate {
    private let runtime: RuntimeConnection
    private var relayWindow: NSWindow?
    private var pairingWindow: NSWindow?
    private var relaySetup: RelaySetupModel?

    init(runtime: RuntimeConnection) {
        self.runtime = runtime
        super.init()
    }

    func showRelaySetup() {
        if let relayWindow, relayWindow.isVisible {
            present(relayWindow)
            return
        }

        let model = RelaySetupModel(runtime: runtime)
        relaySetup = model
        relayWindow = makeWindow(
            title: "Add Relay",
            contentSize: NSSize(width: 460, height: 340),
            content: RelaySetupDialog(
                model: model,
                cancel: { [weak self] in
                    self?.closeRelayWindow()
                }
            )
        )
        relayWindow?.delegate = self
        if let relayWindow {
            present(relayWindow)
        }
    }

    func showPairing(_ pairing: PairingPayload) {
        closeRelayWindow()
        pairingWindow?.close()
        pairingWindow = Self.makePairingWindow(
            content: PairingDialog(
                runtime: runtime,
                pairing: pairing,
                done: { [weak self] in
                    self?.closePairingWindow()
                }
            )
        )
        if let pairingWindow {
            present(pairingWindow)
        }
    }

    private func closeRelayWindow() {
        relaySetup?.cancel()
        relayWindow?.close()
        relayWindow = nil
        relaySetup = nil
    }

    func windowWillClose(_ notification: Notification) {
        guard let window = notification.object as? NSWindow, window === relayWindow else { return }
        relaySetup?.cancel()
        relaySetup = nil
        relayWindow = nil
    }

    private func closePairingWindow() {
        pairingWindow?.close()
        pairingWindow = nil
    }

    private func makeWindow<Content: View>(
        title: String,
        contentSize: NSSize,
        content: Content
    ) -> NSWindow {
        let window = NSWindow(contentViewController: NSHostingController(rootView: content))
        window.title = title
        window.styleMask = [.titled, .closable]
        window.isReleasedWhenClosed = false
        window.setContentSize(contentSize)
        window.center()
        return window
    }

    /// The system owns this utility window's titlebar and Liquid Glass chrome.
    /// The QR code stays in the content layer so the material cannot distort it.
    static func makePairingWindow<Content: View>(content: Content) -> NSWindow {
        let host = NSHostingController(rootView: content)
        host.sceneBridgingOptions = [.title, .toolbars]
        let window = NSWindow(contentViewController: host)
        window.title = "Connect Your Phone"
        window.styleMask = [.titled, .closable, .fullSizeContentView]
        window.titleVisibility = .visible
        window.toolbar = NSToolbar(identifier: "CodeWide.Pairing")
        window.toolbarStyle = .unifiedCompact
        window.isReleasedWhenClosed = false
        window.setContentSize(PairingDialogLayout.contentSize)
        window.center()
        return window
    }

    private func present(_ window: NSWindow) {
        NSApplication.shared.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
        if NSApplication.shared.currentEvent?.type != .keyDown {
            window.makeFirstResponder(nil)
        }
    }
}

@MainActor
enum CompanionNativeDialog {
    static func confirmDestructive(
        title: String,
        message: String,
        actionTitle: String
    ) -> Bool {
        NSApplication.shared.activate(ignoringOtherApps: true)

        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = title
        alert.informativeText = message

        let destructiveButton = alert.addButton(withTitle: actionTitle)
        destructiveButton.hasDestructiveAction = true
        destructiveButton.keyEquivalent = ""

        let cancelButton = alert.addButton(withTitle: "Cancel")
        cancelButton.keyEquivalent = "\u{1b}"

        return alert.runModal() == .alertFirstButtonReturn
    }
}

private struct RelaySetupDialog: View {
    let cancel: @MainActor () -> Void
    @StateObject private var model: RelaySetupModel
    @State private var address = ""

    init(model: RelaySetupModel, cancel: @escaping @MainActor () -> Void) {
        self.cancel = cancel
        _model = StateObject(wrappedValue: model)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Add Relay")
                .font(.title2.weight(.semibold))
            if model.enrollment?.code == nil && model.enrollment?.state != "connected" {
                Text("Run codewide-relay pair on your Relay, then enter the address it shows. Pairing stays open for one minute.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                if let installURL = URL(
                    string: "https://github.com/MrFlashAccount/CodeWide/blob/main/docs/relay-rollout.md#start-relay"
                ) {
                    Link("How to install Relay", destination: installURL)
                        .font(.callout)
                }
            }
            TextField("relay.example.com:8780", text: $address)
                .textFieldStyle(.roundedBorder)
                .accessibilityLabel("Relay address including port")
                .disabled(model.isSubmitting || model.enrollment?.state == "connected")
            if model.enrollment?.state == "connected" {
                Label("Relay connected", systemImage: "checkmark.circle.fill")
                    .foregroundStyle(.green)
                Text("Your computer name and access settings have been saved.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            } else if let code = model.enrollment?.code {
                GroupBox {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Your symbols")
                            .font(.headline)
                        Text(code.components(separatedBy: "\n")[0])
                            .font(.system(size: 34))
                            .accessibilityHidden(true)
                        if let names = code.components(separatedBy: "\n").dropFirst().first {
                            Text(names)
                                .font(.callout)
                                .foregroundStyle(.secondary)
                        }
                        Text("Same symbols in the Relay terminal? Press Enter there to connect.")
                            .font(.callout)
                        Text("\(model.enrollment?.remainingSeconds ?? 0) seconds remaining")
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            if let error = model.error {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.red)
            }
            GlassEffectContainer(spacing: 12) {
              HStack {
                Spacer()
                Button(model.enrollment?.state == "connected" ? "Done" : "Cancel", action: cancel)
                    .buttonStyle(.glass)
                    .keyboardShortcut(.cancelAction)
                if model.enrollment?.state != "connected" {
                    Button {
                        model.connect(address: address)
                    } label: {
                        if model.isSubmitting { ShimmerText("Connect") }
                        else { Text("Connect") }
                    }
                    .buttonStyle(.glassProminent)
                    .keyboardShortcut(.defaultAction)
                    .disabled(address.trimmingCharacters(in: .whitespaces).isEmpty || model.isSubmitting)
                }
              }
              .controlSize(.large)
              .buttonBorderShape(.capsule)
            }
        }
        .padding(22)
        .frame(width: 460)
        .frame(minHeight: 340)
        .tint(CodeWideBrand.accent)
        .onDisappear { model.cancel() }
    }
}

enum PairingDialogLayout {
    static let contentSize = NSSize(width: 580, height: 300)
    static let codeSize: CGFloat = 204
}

struct PairingDialog: View {
    @ObservedObject var runtime: RuntimeConnection
    @State var pairing: PairingPayload
    @State private var route: PairingRoute
    @State private var devicesBeforePairing: Set<String>
    @State private var pairingError: String?
    @State private var isRefreshing = false
    @State private var copiedLink = false
    @State private var pairingRequestID = UUID()
    let done: @MainActor () -> Void

    init(runtime: RuntimeConnection, pairing: PairingPayload, done: @escaping @MainActor () -> Void) {
        self.runtime = runtime
        _pairing = State(initialValue: pairing)
        _route = State(initialValue: runtime.preferredPairingRoute)
        _devicesBeforePairing = State(initialValue: Set(runtime.devices.map(\.id)))
        self.done = done
    }

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            let usable = isPairingUsable(at: context.date)
            HStack(alignment: .top, spacing: 24) {
                codeColumn(usable: usable, now: context.date)
                detailsColumn(usable: usable)
            }
            .padding(24)
            .frame(width: PairingDialogLayout.contentSize.width,
                   height: PairingDialogLayout.contentSize.height,
                   alignment: .top)
        }
        .onChange(of: pairingKey) {
            Task { await refreshPairing() }
        }
        .onChange(of: deviceIDs) {
            if PairingCompletion.hasNewDevice(
                before: devicesBeforePairing,
                after: deviceIDs
            ) {
                done()
            }
        }
    }

    private func codeColumn(usable: Bool, now: Date) -> some View {
        VStack(spacing: 12) {
            Group {
                if usable {
                    PairingQRCode(value: pairing.link)
                        .padding(15)
                        .background(.white, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
                        .accessibilityLabel("One-time CodeWide pairing QR code")
                } else {
                    VStack(spacing: 12) {
                        Image(systemName: pairingError == nil ? "qrcode" : "exclamationmark.triangle")
                            .font(.system(size: 48, weight: .light))
                            .foregroundStyle(pairingError == nil ? Color.secondary : Color.red)
                        if isRefreshing {
                            ShimmerText("Creating secure code")
                        } else {
                            Text(pairingError == nil ? "Code expired" : "QR unavailable")
                        }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(.primary.opacity(0.045),
                                in: RoundedRectangle(cornerRadius: 22, style: .continuous))
                    .accessibilityElement(children: .combine)
                }
            }
            .frame(width: PairingDialogLayout.codeSize, height: PairingDialogLayout.codeSize)

            HStack(spacing: 8) {
                Label(
                    isRefreshing ? "Creating code" : PairingPresentation.expiryText(pairing, at: now),
                    systemImage: isRefreshing ? "arrow.clockwise" : "clock"
                )
                .font(.caption.monospacedDigit())
                .foregroundStyle(.secondary)
                .lineLimit(1)

                Spacer(minLength: 4)

                GlassEffectContainer(spacing: 6) {
                    HStack(spacing: 6) {
                        Button {
                            copyLink()
                        } label: {
                            Image(systemName: copiedLink ? "checkmark" : "doc.on.doc")
                                .contentTransition(.symbolEffect(.replace))
                        }
                        .buttonStyle(.glass)
                        .tint(nil as Color?)
                        .disabled(!usable)
                        .accessibilityLabel("Copy Link")
                        .accessibilityValue(copiedLink ? "Copied" : "")
                        .help("Copy pairing link")

                        Button {
                            Task { await refreshPairing() }
                        } label: {
                            Image(systemName: "arrow.clockwise")
                        }
                        .buttonStyle(.glass)
                        .tint(nil as Color?)
                        .disabled(isRefreshing)
                        .accessibilityLabel("New Code")
                        .help("Create a new pairing code")
                    }
                    .buttonBorderShape(.circle)
                    .controlSize(.small)
                }
            }
            .frame(width: PairingDialogLayout.codeSize)
        }
        .frame(width: PairingDialogLayout.codeSize)
    }

    private func detailsColumn(usable: Bool) -> some View {
        VStack(alignment: .leading, spacing: 20) {
            Text("Scan this code in CodeWide on your phone.")
                .font(.headline)
                .fixedSize(horizontal: false, vertical: true)

            VStack(alignment: .leading, spacing: 8) {
                Text("Connect through")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                PairingConnectionPicker(runtime: runtime, route: $route)
            }

            if let pairingError {
                Label(pairingError, systemImage: "exclamationmark.circle.fill")
                    .font(.caption)
                    .foregroundStyle(.red)
                    .lineLimit(3)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityLabel("Pairing error: \(pairingError)")
            } else if !usable && !isRefreshing {
                Text("This code has expired. Create a new code to continue.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Spacer(minLength: 0)

            HStack {
                Spacer()
                Button("Done", action: done)
                    .buttonStyle(.glassProminent)
                    .buttonBorderShape(.capsule)
                    .tint(CodeWideBrand.actionAccent)
                    .keyboardShortcut(.defaultAction)
            }
        }
        .frame(maxWidth: .infinity,
               minHeight: PairingDialogLayout.codeSize + 40,
               alignment: .topLeading)
    }

    private func isPairingUsable(at date: Date) -> Bool {
        PairingPresentation.isUsable(
            pairing,
            at: date,
            isRefreshing: isRefreshing,
            hasError: pairingError != nil
        )
    }

    private func copyLink() {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(pairing.link, forType: .string)
        copiedLink = true
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(1.5))
            guard !Task.isCancelled else { return }
            copiedLink = false
        }
    }

    private func refreshPairing() async {
        let requestID = UUID()
        pairingRequestID = requestID
        isRefreshing = true
        copiedLink = false
        pairingError = nil
        let key = pairingKey
        defer { if requestID == pairingRequestID { isRefreshing = false } }
        do {
            let result = try await runtime.createPairing(route: route)
            guard requestID == pairingRequestID, key == pairingKey,
                  !Task.isCancelled else { return }
            pairing = result
        } catch {
            guard requestID == pairingRequestID, key == pairingKey,
                  !Task.isCancelled else { return }
            pairingError = error.localizedDescription
        }
    }

    private var pairingKey: String? {
        route.destination(
            endpoint: runtime.pairingEndpoint,
            availableEndpoints: runtime.directAccess?.endpoints ?? [],
            relay: runtime.relay
        )?.key
    }

    private var deviceIDs: Set<String> {
        Set(runtime.devices.map(\.id))
    }
}

enum PairingCompletion {
    static func hasNewDevice(before: Set<String>, after: Set<String>) -> Bool {
        !after.subtracting(before).isEmpty
    }
}

enum PairingPresentation {
    static func isUsable(
        _ pairing: PairingPayload,
        at date: Date,
        isRefreshing: Bool,
        hasError: Bool
    ) -> Bool {
        let now = UInt64(max(0, date.timeIntervalSince1970 * 1_000))
        return !isRefreshing && !hasError && pairing.expiresAtUnixMilliseconds > now
    }

    static func expiryText(_ pairing: PairingPayload, at date: Date) -> String {
        let now = UInt64(max(0, date.timeIntervalSince1970 * 1_000))
        guard pairing.expiresAtUnixMilliseconds > now else { return "Expired" }
        let milliseconds = pairing.expiresAtUnixMilliseconds - now
        let seconds = Int((milliseconds + 999) / 1_000)
        return String(format: "Expires in %d:%02d", seconds / 60, seconds % 60)
    }
}
