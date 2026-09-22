import AppKit
import CodeWideShared
import CoreImage.CIFilterBuiltins
import SwiftUI

@main
@MainActor
struct CodeWideApp: App {
    @StateObject private var runtime: RuntimeConnection
    @StateObject private var updates: UpdateController
    @StateObject private var onboarding: OnboardingWindowController

    init() {
        let runtime = RuntimeConnection()
        let onboarding = OnboardingWindowController(runtime: runtime)
        _runtime = StateObject(wrappedValue: runtime)
        _updates = StateObject(wrappedValue: UpdateController(runtime: runtime))
        _onboarding = StateObject(wrappedValue: onboarding)
        runtime.start()
        DispatchQueue.main.async {
            onboarding.showIfNeeded()
        }
    }

    var body: some Scene {
        MenuBarExtra {
            CompanionPanel(runtime: runtime, updates: updates, onboarding: onboarding)
        } label: {
            Image(nsImage: Self.menuBarImage)
                .opacity(runtime.health == nil ? 0.45 : 1)
                .accessibilityLabel("CodeWide")
        }
        .menuBarExtraStyle(.window)
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

private struct CompanionPanel: View {
    @ObservedObject var runtime: RuntimeConnection
    @ObservedObject var updates: UpdateController
    @ObservedObject var onboarding: OnboardingWindowController

    @State private var showsRelaySetup = false
    @State private var pairing: PairingPayload?
    @State private var revokingDeviceID: String?
    @State private var actionError: String?
    @State private var actionInProgress = false

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            ScrollView {
                VStack(spacing: 12) {
                    relayCard
                    devicesCard
                    if let error = actionError ?? runtime.lastError ?? updates.lastError {
                        errorBanner(error)
                    }
                }
                .padding(14)
            }
            Divider()
            footer
        }
        .frame(width: 390, height: 540)
        .tint(CodeWideBrand.accent)
        .sheet(isPresented: $showsRelaySetup) {
            RelaySetupSheet { address, invitation in
                try await runtime.pairRelay(address: address, invitationJSON: invitation)
            }
        }
        .sheet(
            isPresented: Binding(
                get: { pairing != nil },
                set: { if !$0 { pairing = nil } }
            )
        ) {
            if let pairing {
                PairingSheet(pairing: pairing)
            }
        }
        .confirmationDialog(
            "Revoke this device?",
            isPresented: Binding(
                get: { revokingDeviceID != nil },
                set: { if !$0 { revokingDeviceID = nil } }
            )
        ) {
            Button("Revoke Device", role: .destructive) {
                guard let id = revokingDeviceID else { return }
                revokingDeviceID = nil
                runAction {
                    try await runtime.revokeDevice(id: id)
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("It will be disconnected immediately and must be paired again.")
        }
    }

    private var header: some View {
        HStack(spacing: 10) {
            ZStack {
                Circle()
                    .fill(statusColor.opacity(0.16))
                    .frame(width: 34, height: 34)
                Image(systemName: "bolt.fill")
                    .foregroundStyle(statusColor)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text("CodeWide Companion")
                    .font(.headline)
                Text(runtime.status)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Button {
                Task { await runtime.refresh() }
            } label: {
                Image(systemName: "arrow.clockwise")
            }
            .buttonStyle(.plain)
            .help("Refresh")
        }
        .padding(14)
    }

    private var relayCard: some View {
        GroupBox {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    statusDot(color: relayColor)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(relayTitle)
                            .font(.subheadline.weight(.semibold))
                        if let endpoint = runtime.relay?.publicEndpoint {
                            Text(endpoint)
                                .font(.caption.monospaced())
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                                .truncationMode(.middle)
                        }
                    }
                    Spacer()
                    if runtime.relay?.configured == true {
                        Toggle(
                            "Relay enabled",
                            isOn: Binding(
                                get: { runtime.relay?.enabled == true },
                                set: { enabled in
                                    runAction {
                                        try await runtime.setRelayEnabled(enabled)
                                    }
                                }
                            )
                        )
                        .labelsHidden()
                        .disabled(actionInProgress)
                    }
                }
                HStack {
                    Button(runtime.relay?.configured == true ? "Change Relay…" : "Add Relay…") {
                        showsRelaySetup = true
                    }
                    Spacer()
                    Button("Pair Device…") {
                        runAction {
                            pairing = try await runtime.createPairing()
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(runtime.relay?.connection != "online" || actionInProgress)
                }
            }
            .padding(4)
        } label: {
            Label("Relay", systemImage: "network")
                .font(.subheadline.weight(.semibold))
        }
    }

    private var devicesCard: some View {
        GroupBox {
            if runtime.devices.isEmpty {
                VStack(spacing: 7) {
                    Image(systemName: "iphone.slash")
                        .font(.title2)
                        .foregroundStyle(.secondary)
                    Text("No paired devices")
                        .font(.subheadline.weight(.medium))
                    Text("Pair a phone after the Relay is online.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
            } else {
                VStack(spacing: 0) {
                    ForEach(runtime.devices, id: \.id) { device in
                        if device.id != runtime.devices.first?.id { Divider() }
                        deviceRow(device)
                    }
                }
            }
        } label: {
            HStack {
                Label("Devices", systemImage: "iphone.and.arrow.forward")
                    .font(.subheadline.weight(.semibold))
                Spacer()
                Text("\(runtime.devices.count)")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func deviceRow(_ device: DeviceStatusPayload) -> some View {
        HStack(spacing: 9) {
            statusDot(color: device.activeConnections > 0 ? .green : .secondary)
            VStack(alignment: .leading, spacing: 2) {
                Text(device.name)
                    .font(.subheadline.weight(.medium))
                Text(device.activeConnections > 0 ? "Online" : lastSeenText(device))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Button(role: .destructive) {
                revokingDeviceID = device.id
            } label: {
                Image(systemName: "trash")
            }
            .buttonStyle(.plain)
            .help("Revoke \(device.name)")
            .disabled(actionInProgress)
        }
        .padding(.vertical, 9)
        .padding(.horizontal, 4)
    }

    private var footer: some View {
        HStack {
            if let health = runtime.health {
                Text("v\(health.appVersion) · PID \(health.processID)")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Menu {
                if runtime.requiresApproval {
                    Button("Open Login Items Settings") {
                        runtime.openLoginItemsSettings()
                    }
                }
                Button(updates.availableVersion.map { "Install \($0)" } ?? "Check for Updates…") {
                    updates.checkForUpdates()
                }
                .disabled(!updates.canCheckForUpdates)
                Button("Run Setup Again…") {
                    onboarding.show()
                }
                Divider()
                Button("Quit CodeWide") {
                    NSApplication.shared.terminate(nil)
                }
                .keyboardShortcut("q")
            } label: {
                Image(systemName: "ellipsis.circle")
            }
            .menuStyle(.borderlessButton)
            .fixedSize()
        }
        .padding(12)
    }

    private var statusColor: Color {
        runtime.health == nil ? .secondary : (runtime.health?.phase == "running" ? .green : .orange)
    }

    private var relayColor: Color {
        switch runtime.relay?.connection {
        case "online": .green
        case "connecting", "reconnecting": .orange
        default: .secondary
        }
    }

    private var relayTitle: String {
        guard let relay = runtime.relay else { return "Relay unavailable" }
        guard relay.configured else { return "Relay not configured" }
        switch relay.connection {
        case "online": return "Relay online"
        case "connecting": return "Connecting to Relay"
        case "reconnecting": return "Relay unreachable · retrying"
        default: return "Relay disabled"
        }
    }

    private func statusDot(color: Color) -> some View {
        Circle().fill(color).frame(width: 8, height: 8)
    }

    private func lastSeenText(_ device: DeviceStatusPayload) -> String {
        let date = Date(timeIntervalSince1970: TimeInterval(device.lastSeenAtUnixMilliseconds) / 1_000)
        return "Last seen \(date.formatted(.relative(presentation: .named)))"
    }

    private func errorBanner(_ error: String) -> some View {
        Label(error, systemImage: "exclamationmark.triangle.fill")
            .font(.caption)
            .foregroundStyle(.red)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(10)
            .background(.red.opacity(0.08), in: RoundedRectangle(cornerRadius: 9))
    }

    private func runAction(_ action: @escaping @MainActor () async throws -> Void) {
        guard !actionInProgress else { return }
        actionInProgress = true
        actionError = nil
        Task {
            defer { actionInProgress = false }
            do {
                try await action()
            } catch {
                actionError = error.localizedDescription
            }
        }
    }
}

private struct RelaySetupSheet: View {
    let submit: @MainActor (String, String) async throws -> Void

    @Environment(\.dismiss) private var dismiss
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
            TextField("relay.example.com:8780", text: $address)
                .textFieldStyle(.roundedBorder)
            TextEditor(text: $invitation)
                .font(.body.monospaced())
                .frame(minHeight: 120)
                .overlay {
                    RoundedRectangle(cornerRadius: 6)
                        .stroke(Color(nsColor: .separatorColor))
                }
            if let error {
                Text(error).font(.caption).foregroundStyle(.red)
            }
            HStack {
                Spacer()
                Button("Cancel") { dismiss() }
                Button("Connect") {
                    isSubmitting = true
                    error = nil
                    Task {
                        do {
                            try await submit(address.trimmingCharacters(in: .whitespaces), invitation)
                            dismiss()
                        } catch {
                            self.error = error.localizedDescription
                            isSubmitting = false
                        }
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(address.trimmingCharacters(in: .whitespaces).isEmpty || invitation.isEmpty || isSubmitting)
            }
        }
        .padding(20)
        .frame(width: 440)
    }
}

private struct PairingSheet: View {
    let pairing: PairingPayload

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 14) {
            Text("Pair a Device")
                .font(.title2.weight(.semibold))
            Text("Scan this code in CodeWide. It expires \(expiryText).")
                .font(.callout)
                .foregroundStyle(.secondary)
            PairingQRCode(value: pairing.link)
                .frame(width: 230, height: 230)
            HStack {
                Button("Copy Link") {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(pairing.link, forType: .string)
                }
                Spacer()
                Button("Done") { dismiss() }
                    .buttonStyle(.borderedProminent)
            }
            .frame(width: 230)
        }
        .padding(22)
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
