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
    @State private var pairAfterRelaySetup = false
    @State private var dismissedError: String?

    var body: some View {
        VStack(spacing: 0) {
            header
            overview
            errorBanner
            clients
            footer
        }
        .frame(width: 400, height: 560)
        .tint(CodeWideBrand.accent)
        .task {
            await runtime.discoverAppServers()
        }
        .sheet(isPresented: $showsRelaySetup) {
            RelaySetupSheet { address, invitation in
                try await runtime.pairRelay(address: address, invitationJSON: invitation)
                if pairAfterRelaySetup {
                    pairing = try await runtime.createPairing()
                    pairAfterRelaySetup = false
                }
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
            "Revoke this client?",
            isPresented: Binding(
                get: { revokingDeviceID != nil },
                set: { if !$0 { revokingDeviceID = nil } }
            )
        ) {
            Button("Revoke Client", role: .destructive) {
                guard let id = revokingDeviceID else { return }
                revokingDeviceID = nil
                runAction {
                    try await runtime.revokeDevice(id: id)
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("It will be disconnected immediately and must be added again.")
        }
    }

    private var header: some View {
        HStack(spacing: 11) {
            ZStack {
                Circle()
                    .fill(appServerColor.opacity(0.14))
                Image(systemName: "server.rack")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(statusColor)
            }
            .frame(width: 32, height: 32)

            VStack(alignment: .leading, spacing: 2) {
                appServerPicker
                Text(appServerSummary)
                    .font(.caption)
                    .foregroundStyle(appServerColor)
                    .lineLimit(1)
            }

            Spacer(minLength: 12)

            Button {
                beginPairing()
            } label: {
                Image(systemName: "person.badge.plus")
            }
            .buttonStyle(.glass)
            .help("Add client")
            .disabled(runtime.health == nil || actionInProgress)

            Button {
                Task {
                    await runtime.refresh()
                    await runtime.discoverAppServers()
                }
            } label: {
                Image(systemName: "arrow.clockwise")
            }
            .buttonStyle(.glass)
            .help("Refresh")
        }
        .padding(.horizontal, 16)
        .padding(.top, 15)
        .padding(.bottom, 11)
    }

    @ViewBuilder
    private var appServerPicker: some View {
        if runtime.appServers.count > 1 {
            Menu {
                ForEach(runtime.appServers, id: \.id) { server in
                    Button {
                        runAction {
                            try await runtime.selectAppServer(id: server.id)
                        }
                    } label: {
                        if server.selected {
                            Label(appServerMenuTitle(server), systemImage: "checkmark")
                        } else {
                            Text(appServerMenuTitle(server))
                        }
                    }
                    .disabled(!isAvailable(server) || server.selected || actionInProgress)
                }
                Divider()
                Button("Scan Again") {
                    Task { await runtime.discoverAppServers() }
                }
            } label: {
                HStack(spacing: 5) {
                    Text(runtime.appServer?.displayName ?? "Codex App Server")
                        .font(.system(size: 14, weight: .semibold))
                        .lineLimit(1)
                    Image(systemName: "chevron.down")
                        .font(.system(size: 8, weight: .bold))
                        .foregroundStyle(.tertiary)
                }
            }
            .menuIndicator(.hidden)
            .buttonStyle(.plain)
            .fixedSize()
        } else {
            Text(runtime.appServer?.displayName ?? "Codex App Server")
                .font(.system(size: 14, weight: .semibold))
                .lineLimit(1)
        }
    }

    private var overview: some View {
        HStack(spacing: 14) {
            metric(
                value: runtime.health == nil ? "Offline" : "Running",
                label: "Companion",
                color: runtime.health == nil ? .secondary : .green
            )
            metric(
                value: relayMetricValue,
                label: "Relay",
                color: relayColor
            )
            metric(
                value: "\(runtime.devices.count)",
                label: runtime.devices.count == 1 ? "Client" : "Clients",
                color: runtime.devices.isEmpty ? .secondary : CodeWideBrand.accent
            )
            Spacer()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 9)
        .background(Color.primary.opacity(0.035))
        .overlay(alignment: .bottom) {
            Divider()
        }
    }

    @ViewBuilder
    private var errorBanner: some View {
        if let error = visibleError, dismissedError != error {
            HStack(alignment: .top, spacing: 9) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.red)
                    .frame(width: 16, height: 16)
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(3)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Button {
                    dismissedError = error
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 9, weight: .bold))
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
            }
            .padding(11)
            .background(
                Color.red.opacity(0.075),
                in: RoundedRectangle(cornerRadius: 10, style: .continuous)
            )
            .overlay {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .stroke(Color.red.opacity(0.16), lineWidth: 1)
            }
            .padding(.horizontal, 16)
            .padding(.top, 11)
        }
    }

    private var clients: some View {
        Group {
            if runtime.devices.isEmpty {
                VStack(spacing: 12) {
                    Image(systemName: "iphone.and.arrow.forward")
                        .font(.system(size: 30, weight: .regular))
                        .foregroundStyle(.secondary)
                        .frame(width: 64, height: 64)
                        .background(Color.primary.opacity(0.055), in: Circle())
                    Text("No clients")
                        .font(.headline)
                    Text(emptyClientsDescription)
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: 260)
                    Button("Add client") {
                        beginPairing()
                    }
                    .buttonStyle(.glassProminent)
                    .disabled(runtime.health == nil || actionInProgress)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(runtime.devices, id: \.id) { device in
                            deviceRow(device)
                            if device.id != runtime.devices.last?.id {
                                Divider().padding(.leading, 42)
                            }
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
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
            .help("Revoke client \(device.name)")
            .disabled(actionInProgress)
        }
        .padding(.vertical, 11)
        .padding(.horizontal, 4)
    }

    private var footer: some View {
        HStack {
            if let health = runtime.health {
                Text("CodeWide \(health.appVersion) · Core \(health.coreVersion)")
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
                Button(runtime.relay?.configured == true ? "Change Relay…" : "Add Relay…") {
                    pairAfterRelaySetup = false
                    showsRelaySetup = true
                }
                if runtime.relay?.configured == true {
                    Button(runtime.relay?.enabled == true ? "Disable Relay" : "Enable Relay") {
                        runAction {
                            try await runtime.setRelayEnabled(runtime.relay?.enabled != true)
                        }
                    }
                }
                Divider()
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
        .padding(.horizontal, 16)
        .padding(.vertical, 11)
        .overlay(alignment: .top) { Divider() }
    }

    private var statusColor: Color {
        appServerColor
    }

    private var appServerColor: Color {
        guard runtime.health != nil else { return .secondary }
        guard let appServer = runtime.appServer else { return .orange }
        switch appServer.state {
        case .available: .green
        case .unavailable: .orange
        }
    }

    private var relayColor: Color {
        switch runtime.relay?.connection {
        case "online": .green
        case "connecting", "reconnecting": .orange
        default: .secondary
        }
    }

    private var relayMetricValue: String {
        guard let relay = runtime.relay, relay.configured else { return "Not set" }
        switch relay.connection {
        case "online": "Online"
        case "connecting", "reconnecting": "Connecting"
        default: "Disabled"
        }
    }

    private var appServerSummary: String {
        guard let server = runtime.appServer else { return runtime.status }
        switch server.state {
        case let .available(version):
            version.map { "App Server \($0)" } ?? "App Server connected"
        case let .unavailable(lastKnownVersion):
            lastKnownVersion.map { "App Server \($0) unavailable" } ?? "App Server unavailable"
        }
    }

    private var emptyClientsDescription: String {
        runtime.relay?.connection == "online"
            ? "Create a secure QR code or copyable link for a new client."
            : "Add a Relay before connecting your first client."
    }

    private var visibleError: String? {
        actionError ?? runtime.lastError ?? updates.lastError
    }

    private func metric(value: String, label: String, color: Color) -> some View {
        HStack(spacing: 5) {
            Circle().fill(color).frame(width: 6, height: 6)
            Text(value)
                .font(.caption.weight(.semibold))
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private func appServerMenuTitle(_ server: AppServerPayload) -> String {
        switch server.state {
        case let .available(version):
            version.map { "\(server.displayName) · \($0)" } ?? server.displayName
        case .unavailable:
            "\(server.displayName) · Unavailable"
        }
    }

    private func isAvailable(_ server: AppServerPayload) -> Bool {
        if case .available = server.state {
            return true
        }
        return false
    }

    private func statusDot(color: Color) -> some View {
        Circle().fill(color).frame(width: 8, height: 8)
    }

    private func lastSeenText(_ device: DeviceStatusPayload) -> String {
        let date = Date(timeIntervalSince1970: TimeInterval(device.lastSeenAtUnixMilliseconds) / 1_000)
        return "Last seen \(date.formatted(.relative(presentation: .named)))"
    }

    private func beginPairing() {
        dismissedError = nil
        guard runtime.relay?.connection == "online" else {
            if runtime.relay?.configured == true {
                actionError = "Relay is unavailable. Wait for it to reconnect before adding a client."
            } else {
                pairAfterRelaySetup = true
                showsRelaySetup = true
            }
            return
        }
        runAction {
            pairing = try await runtime.createPairing()
        }
    }

    private func runAction(_ action: @escaping @MainActor () async throws -> Void) {
        guard !actionInProgress else { return }
        actionInProgress = true
        actionError = nil
        dismissedError = nil
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
                Spacer()
                Button("Done") { dismiss() }
                    .buttonStyle(.borderedProminent)
            }
            .frame(width: 280)
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
