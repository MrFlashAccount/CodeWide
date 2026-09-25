import AppKit
import CodeWideShared
import Combine
import CoreImage.CIFilterBuiltins
import SwiftUI

enum RelaySetupPurpose {
    case configureRelay
    case pairClient
}

@MainActor
final class CompanionDialogController: ObservableObject {
    private let runtime: RuntimeConnection
    private var relayWindow: NSWindow?
    private var pairingWindow: NSWindow?

    init(runtime: RuntimeConnection) {
        self.runtime = runtime
    }

    func showRelaySetup(for purpose: RelaySetupPurpose) {
        if let relayWindow, relayWindow.isVisible {
            present(relayWindow)
            return
        }

        relayWindow = makeWindow(
            title: "Add Relay",
            contentSize: NSSize(width: 460, height: 390),
            content: RelaySetupDialog(
                cancel: { [weak self] in
                    self?.closeRelayWindow()
                },
                submit: { [weak self] address, invitation in
                    guard let self else { return }
                    try await runtime.pairRelay(
                        address: address,
                        invitationJSON: invitation
                    )
                    let pairing = if purpose == .pairClient {
                        try await runtime.createPairing()
                    } else {
                        nil
                    }
                    closeRelayWindow()
                    if let pairing {
                        showPairing(pairing)
                    }
                }
            )
        )
        if let relayWindow {
            present(relayWindow)
        }
    }

    func showPairing(_ pairing: PairingPayload) {
        closeRelayWindow()
        pairingWindow?.close()
        pairingWindow = makeWindow(
            title: "Add a Client",
            contentSize: NSSize(width: 380, height: 470),
            content: PairingDialog(
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
        relayWindow?.close()
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
        window.styleMask = [.titled, .closable, .fullSizeContentView]
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.isMovableByWindowBackground = true
        window.isReleasedWhenClosed = false
        window.setContentSize(contentSize)
        window.center()
        return window
    }

    private func present(_ window: NSWindow) {
        NSApplication.shared.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
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
    let submit: @MainActor (String, String) async throws -> Void

    @State private var address = ""
    @State private var invitation = ""
    @State private var error: String?
    @State private var isSubmitting = false

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Add Relay")
                .font(.title2.weight(.semibold))
            Text("Run `codewide-relay invite` on the Relay host, then paste its host:port and JSON bundle here.")
                .font(.callout)
                .foregroundStyle(.secondary)
            if let installURL = URL(
                string: "https://github.com/MrFlashAccount/CodeWide/blob/main/docs/relay-rollout.md#start-relay"
            ) {
                Link("How to install Relay", destination: installURL)
                    .font(.callout)
            }
            TextField("relay.example.com:8780", text: $address)
                .textFieldStyle(.roundedBorder)
            TextEditor(text: $invitation)
                .font(.body.monospaced())
                .frame(minHeight: 120)
                .overlay {
                    RoundedRectangle(cornerRadius: 6)
                        .stroke(Color(nsColor: .separatorColor))
                        .allowsHitTesting(false)
                }
            if let error {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.red)
            }
            HStack {
                Spacer()
                Button("Cancel", action: cancel)
                    .buttonStyle(.glass)
                Button {
                    isSubmitting = true
                    error = nil
                    Task {
                        do {
                            try await submit(
                                address.trimmingCharacters(in: .whitespaces),
                                invitation
                            )
                        } catch {
                            self.error = error.localizedDescription
                            isSubmitting = false
                        }
                    }
                } label: {
                    if isSubmitting {
                        ShimmerText("Connecting")
                    } else {
                        Text("Connect")
                    }
                }
                .buttonStyle(.glassProminent)
                .disabled(
                    address.trimmingCharacters(in: .whitespaces).isEmpty
                        || invitation.isEmpty
                        || isSubmitting
                )
            }
        }
        .padding(22)
        .frame(width: 460, minHeight: 390)
        .tint(CodeWideBrand.accent)
    }
}

private struct PairingDialog: View {
    let pairing: PairingPayload
    let done: @MainActor () -> Void

    var body: some View {
        VStack(spacing: 14) {
            Text("Add a Client")
                .font(.title2.weight(.semibold))
            Text("Scan this code in CodeWide. It expires \(expiryText).")
                .font(.callout)
                .foregroundStyle(.secondary)
            PairingQRCode(value: pairing.link)
                .frame(width: 230, height: 230)
            Text(pairing.link)
                .font(.caption.monospaced())
                .foregroundStyle(.secondary)
                .lineLimit(2)
                .truncationMode(.middle)
                .textSelection(.enabled)
                .frame(width: 280)
                .padding(9)
                .background(
                    Color.primary.opacity(0.055),
                    in: RoundedRectangle(cornerRadius: 8, style: .continuous)
                )
            HStack {
                Button("Copy Link") {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(pairing.link, forType: .string)
                }
                .buttonStyle(.glass)
                Spacer()
                Button("Done", action: done)
                    .buttonStyle(.glassProminent)
            }
            .frame(width: 280)
        }
        .padding(22)
        .frame(width: 380, minHeight: 470)
        .tint(CodeWideBrand.accent)
    }

    private var expiryText: String {
        let date = Date(timeIntervalSince1970: TimeInterval(pairing.expiresAtUnixMilliseconds) / 1_000)
        return date.formatted(date: .omitted, time: .shortened)
    }
}

struct PairingQRCode: View {
    let value: String

    var body: some View {
        if let image = makeImage() {
            Image(nsImage: image)
                .interpolation(.none)
                .resizable()
        } else {
            ContentUnavailableView("QR unavailable", systemImage: "qrcode")
        }
    }

    private func makeImage() -> NSImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(value.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage?.transformed(by: .init(scaleX: 8, y: 8)) else {
            return nil
        }
        let representation = NSCIImageRep(ciImage: output)
        let image = NSImage(size: representation.size)
        image.addRepresentation(representation)
        return image
    }
}
