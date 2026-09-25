import AppKit
import CodeWideShared
import SwiftUI

private enum OnboardingStep: Int, CaseIterable, Identifiable {
    case appServer
    case relay
    case client

    var id: Int { rawValue }

    var title: String {
        switch self {
        case .appServer: "App Server"
        case .relay: "Relay"
        case .client: "Client"
        }
    }
}

struct OnboardingFlow: View {
    @ObservedObject var runtime: RuntimeConnection
    let finish: @MainActor () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Namespace private var glassNamespace
    @State private var step = OnboardingStep.appServer
    @State private var relayFormVisible = false
    @State private var relayAddress = ""
    @State private var relayInvitation = ""
    @State private var relayError: String?
    @State private var relayActionInProgress = false
    @State private var pairing: PairingPayload?
    @State private var pairingError: String?
    @State private var selectionInProgress = false
    @State private var appServerStartInProgress = false
    @State private var appServerError: String?

    var body: some View {
        ZStack {
            OnboardingBackdrop()

            GlassEffectContainer(spacing: 18) {
                VStack(spacing: 14) {
                    header
                        .glassEffect(.regular, in: .rect(cornerRadius: 22))
                        .glassEffectID("onboarding-header", in: glassNamespace)

                    ZStack {
                        page
                            .id(step)
                            .transition(pageTransition)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .glassEffect(.regular, in: .rect(cornerRadius: 28))
                    .glassEffectID("onboarding-page", in: glassNamespace)

                    footer
                }
                .padding(18)
            }
        }
        .frame(minWidth: 660, minHeight: 480)
        .tint(CodeWideBrand.accent)
        .task {
            await runtime.discoverAppServers()
        }
        .task(id: step) {
            guard
                step == .client,
                pairing == nil,
                runtime.relay?.connection == "online"
            else {
                return
            }
            await createPairing()
        }
    }

    private var header: some View {
        HStack(spacing: 10) {
            CodeWideBrandMark(size: 26)
            Text("Set up CodeWide")
                .font(.headline)
            Spacer()
            HStack(spacing: 7) {
                ForEach(OnboardingStep.allCases) { candidate in
                    Capsule()
                        .fill(candidate.rawValue <= step.rawValue
                            ? CodeWideBrand.accent
                            : Color.secondary.opacity(0.22))
                        .frame(width: candidate == step ? 18 : 7, height: 7)
                        .animation(
                            reduceMotion ? nil : .snappy(duration: 0.28),
                            value: step
                        )
                        .accessibilityLabel(candidate.title)
                        .accessibilityValue(candidate == step ? "Current step" : "")
                }
            }
            Text("\(step.rawValue + 1) of \(OnboardingStep.allCases.count)")
                .font(.caption.monospacedDigit())
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 13)
    }

    @ViewBuilder
    private var page: some View {
        switch step {
        case .appServer:
            appServerPage
        case .relay:
            relayPage
        case .client:
            clientPage
        }
    }

    private var appServerPage: some View {
        OnboardingPage(
            symbol: "server.rack",
            title: "Choose a Codex App Server",
            subtitle: "CodeWide connects to a local App Server and keeps the Companion available in the background."
        ) {
            VStack(alignment: .leading, spacing: 10) {
                if runtime.isDiscoveringAppServers && runtime.appServers.isEmpty {
                    ShimmerText("Looking for App Servers")
                        .frame(maxWidth: .infinity, minHeight: 84)
                } else {
                    ForEach(runtime.appServers, id: \.id) { server in
                        appServerRow(server)
                    }
                }

                if !hasAvailableAppServer && !runtime.isDiscoveringAppServers {
                    appServerRecovery
                }

                HStack {
                    Spacer()
                    Button {
                        Task { await runtime.discoverAppServers() }
                    } label: {
                        if runtime.isDiscoveringAppServers {
                            ShimmerText("Scan Again")
                        } else {
                            Text("Scan Again")
                        }
                    }
                    .controlSize(.small)
                    .buttonStyle(.glass)
                    .disabled(runtime.isDiscoveringAppServers || appServerStartInProgress)
                    if let installURL = URL(string: "https://developers.openai.com/codex/cli") {
                        Link("How to install", destination: installURL)
                            .font(.caption)
                    }
                }

                if let appServerError {
                    Text(appServerError)
                        .font(.caption)
                        .foregroundStyle(.red)
                }

                if runtime.requiresApproval {
                    Button("Open Login Items Settings") {
                        runtime.openLoginItemsSettings()
                    }
                    .controlSize(.small)
                    .buttonStyle(.glass)
                }
            }
        }
    }

    @ViewBuilder
    private var appServerRecovery: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("No reachable App Server was found.")
                .font(.caption)
                .foregroundStyle(.red)

            switch runtime.codexInstallation {
            case let .ready(installedVersion):
                HStack(spacing: 10) {
                    Text("Codex \(installedVersion) is ready. CodeWide can start its App Server.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Spacer()
                    Button {
                        startSelectedAppServer()
                    } label: {
                        if appServerStartInProgress {
                            ShimmerText("Start App Server")
                        } else {
                            Text("Start App Server")
                        }
                    }
                    .buttonStyle(.glassProminent)
                    .controlSize(.small)
                    .disabled(selectedUnavailableAppServer == nil || appServerStartInProgress)
                }
            case let .updateRequired(installedVersion, minimumVersion):
                Text(
                    "Codex \(installedVersion) is installed. CodeWide requires \(minimumVersion) or newer."
                )
                .font(.caption)
                .foregroundStyle(.secondary)
            case let .notFound(minimumVersion):
                Text("Install Codex \(minimumVersion) or newer, then scan again.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            case let .unverified(minimumVersion):
                Text("CodeWide found Codex but could not verify version \(minimumVersion) or newer.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            case nil:
                EmptyView()
            }
        }
        .padding(.horizontal, 2)
    }

    private func appServerRow(_ server: AppServerPayload) -> some View {
        Button {
            selectAppServer(server)
        } label: {
            HStack(spacing: 11) {
                Image(systemName: server.selected ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(server.selected ? CodeWideBrand.accent : Color.secondary)
                VStack(alignment: .leading, spacing: 3) {
                    Text(server.displayName)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.primary)
                    Text(server.codexHome.abbreviatingWithTilde)
                        .font(.caption.monospaced())
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
                Spacer()
                AppServerStateLabel(state: server.state)
            }
            .padding(.horizontal, 12)
            .frame(height: 54)
            .contentShape(Rectangle())
            .background(
                server.selected ? CodeWideBrand.accent.opacity(0.12) : Color.clear,
                in: RoundedRectangle(cornerRadius: 10, style: .continuous)
            )
        }
        .buttonStyle(.plain)
        .disabled(!isAvailable(server) || server.selected || selectionInProgress)
    }

    private var relayPage: some View {
        OnboardingPage(
            symbol: "antenna.radiowaves.left.and.right",
            title: "Connect from anywhere",
            subtitle: "Relay gives your clients a secure route back to this Mac. You can also skip it and configure access later."
        ) {
            VStack(alignment: .leading, spacing: 14) {
                if runtime.relay?.configured == true && !relayFormVisible {
                    relayStatus
                } else if relayFormVisible {
                    relayForm
                } else {
                    VStack(spacing: 12) {
                        Button("Add Relay") {
                            withAnimation(reduceMotion ? nil : .snappy(duration: 0.25)) {
                                relayFormVisible = true
                            }
                        }
                        .buttonStyle(.glassProminent)
                        if let installURL = URL(
                            string: "https://github.com/MrFlashAccount/CodeWide/blob/main/docs/relay-rollout.md#start-relay"
                        ) {
                            Link("How to install Relay", destination: installURL)
                                .font(.callout)
                        }
                    }
                    .frame(maxWidth: .infinity, minHeight: 160)
                }
            }
        }
    }

    private var relayStatus: some View {
        HStack(spacing: 11) {
            Circle()
                .fill(runtime.relay?.connection == "online" ? Color.green : Color.orange)
                .frame(width: 9, height: 9)
            VStack(alignment: .leading, spacing: 3) {
                Text(runtime.relay?.connection == "online" ? "Relay connected" : "Relay reconnecting")
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
            Button("Change") {
                relayFormVisible = true
            }
            .controlSize(.small)
            .buttonStyle(.glass)
        }
        .padding(.horizontal, 4)
        .padding(.vertical, 12)
    }

    private var relayForm: some View {
        VStack(alignment: .leading, spacing: 10) {
            TextField("relay.example.com:8780", text: $relayAddress)
                .textFieldStyle(.roundedBorder)
            TextEditor(text: $relayInvitation)
                .font(.callout.monospaced())
                .frame(height: 80)
                .overlay {
                    RoundedRectangle(cornerRadius: 6)
                        .stroke(Color(nsColor: .separatorColor))
                }
            HStack {
                Text("Paste the JSON from `codewide-relay invite`.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
                Button("Connect") {
                    connectRelay()
                }
                .buttonStyle(.glassProminent)
                .disabled(
                    relayAddress.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                        || relayInvitation.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                        || relayActionInProgress
                )
            }
            if let relayError {
                Text(relayError)
                    .font(.caption)
                    .foregroundStyle(.red)
            }
        }
    }

    private var clientPage: some View {
        OnboardingPage(
            symbol: "iphone.and.arrow.forward",
            title: runtime.devices.isEmpty ? "Add your first client" : "Client connected",
            subtitle: clientSubtitle
        ) {
            Group {
                if let device = runtime.devices.first {
                    VStack(spacing: 12) {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.system(size: 48))
                            .foregroundStyle(.green)
                            .symbolEffect(.bounce, value: runtime.devices.count)
                        Text(device.name)
                            .font(.headline)
                        Text("Ready to use CodeWide")
                            .font(.callout)
                            .foregroundStyle(.secondary)
                    }
                } else if runtime.relay?.connection != "online" {
                    VStack(spacing: 12) {
                        Image(systemName: "iphone.slash")
                            .font(.system(size: 36, weight: .light))
                            .foregroundStyle(.secondary)
                        Text("No client added")
                            .font(.headline)
                        Text("Add a Relay from the menu bar when you are ready to connect a client.")
                            .font(.callout)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                            .frame(maxWidth: 310)
                    }
                } else if let pairing {
                    HStack(spacing: 22) {
                        PairingQRCode(value: pairing.link)
                            .frame(width: 150, height: 150)
                            .padding(9)
                            .background(Color.white, in: RoundedRectangle(cornerRadius: 12))
                        VStack(alignment: .leading, spacing: 10) {
                            Text("Scan in CodeWide")
                                .font(.headline)
                            Text(pairing.link)
                                .font(.caption.monospaced())
                                .foregroundStyle(.secondary)
                                .lineLimit(3)
                                .truncationMode(.middle)
                                .textSelection(.enabled)
                            Button("Copy Link") {
                                copy(pairing.link)
                            }
                            .controlSize(.small)
                            .buttonStyle(.glass)
                        }
                        .frame(width: 210, alignment: .leading)
                    }
                } else {
                    VStack(spacing: 10) {
                        if let pairingError {
                            Text(pairingError)
                                .font(.callout)
                                .foregroundStyle(.red)
                        } else {
                            ShimmerText("Creating a secure pairing link")
                                .font(.callout)
                        }
                        if pairingError != nil {
                            Button("Try Again") {
                                Task { await createPairing() }
                            }
                            .buttonStyle(.glass)
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity, minHeight: 190)
        }
    }

    private var footer: some View {
        HStack(spacing: 10) {
            if step != .appServer {
                Button("Back") {
                    guard let previous = OnboardingStep(rawValue: step.rawValue - 1) else { return }
                    move(to: previous)
                }
                .buttonStyle(.glass)
            }

            Spacer()

            if step == .relay {
                Button("Skip") {
                    move(to: .client)
                }
                .buttonStyle(.glass)
            }
            if step == .client && runtime.devices.isEmpty {
                Button("Add Later") {
                    finish()
                }
                .buttonStyle(.glass)
            }

            Button(step == .client ? "Finish" : "Continue") {
                advance()
            }
            .buttonStyle(.glassProminent)
            .disabled(!canContinue)
        }
        .padding(.horizontal, 4)
        .padding(.top, 2)
    }

    private var canContinue: Bool {
        switch step {
        case .appServer:
            runtime.health != nil
                && isCurrentAppServerAvailable
                && !selectionInProgress
                && !appServerStartInProgress
        case .relay:
            runtime.relay?.connection == "online"
        case .client:
            true
        }
    }

    private var isCurrentAppServerAvailable: Bool {
        guard let server = runtime.appServer else { return false }
        return isAvailable(server)
    }

    private var hasAvailableAppServer: Bool {
        runtime.appServers.contains { server in
            isAvailable(server)
        }
    }

    private var selectedUnavailableAppServer: AppServerPayload? {
        runtime.appServers.first { server in
            server.selected && !isAvailable(server)
        }
    }

    private var clientSubtitle: String {
        runtime.relay?.connection == "online"
            ? "Scan the one-time QR code or copy its link. It expires automatically."
            : "You skipped Relay, so client pairing will stay unavailable until a Relay is added."
    }

    private var pageTransition: AnyTransition {
        .asymmetric(
            insertion: .offset(x: 14).combined(with: .opacity),
            removal: .offset(x: -14).combined(with: .opacity)
        )
    }

    private func advance() {
        if step == .client {
            finish()
            return
        }
        guard let next = OnboardingStep(rawValue: step.rawValue + 1) else { return }
        move(to: next)
    }

    private func move(to destination: OnboardingStep) {
        withAnimation(reduceMotion ? nil : .snappy(duration: 0.32)) {
            step = destination
        }
    }

    private func selectAppServer(_ server: AppServerPayload) {
        guard isAvailable(server), !server.selected, !selectionInProgress else { return }
        selectionInProgress = true
        appServerError = nil
        Task {
            defer { selectionInProgress = false }
            do {
                try await runtime.selectAppServer(id: server.id)
            } catch {
                appServerError = error.localizedDescription
            }
        }
    }

    private func startSelectedAppServer() {
        guard let server = selectedUnavailableAppServer, !appServerStartInProgress else { return }
        appServerStartInProgress = true
        appServerError = nil
        Task {
            defer { appServerStartInProgress = false }
            do {
                try await runtime.startAppServer(id: server.id)
            } catch {
                appServerError = error.localizedDescription
            }
        }
    }

    private func connectRelay() {
        guard !relayActionInProgress else { return }
        relayActionInProgress = true
        relayError = nil
        let address = relayAddress.trimmingCharacters(in: .whitespacesAndNewlines)
        let invitation = relayInvitation.trimmingCharacters(in: .whitespacesAndNewlines)
        Task {
            defer { relayActionInProgress = false }
            do {
                try await runtime.pairRelay(address: address, invitationJSON: invitation)
                relayFormVisible = false
            } catch {
                relayError = error.localizedDescription
            }
        }
    }

    private func createPairing() async {
        pairing = nil
        pairingError = nil
        do {
            pairing = try await runtime.createPairing()
        } catch {
            pairingError = error.localizedDescription
        }
    }

    private func copy(_ value: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(value, forType: .string)
    }

    private func isAvailable(_ server: AppServerPayload) -> Bool {
        if case .available = server.state {
            return true
        }
        return false
    }
}

private struct OnboardingPage<Content: View>: View {
    let symbol: String
    let title: String
    let subtitle: String
    let content: Content

    init(
        symbol: String,
        title: String,
        subtitle: String,
        @ViewBuilder content: () -> Content
    ) {
        self.symbol = symbol
        self.title = title
        self.subtitle = subtitle
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 14) {
                Image(systemName: symbol)
                    .font(.system(size: 22, weight: .medium))
                    .foregroundStyle(CodeWideBrand.accent)
                    .frame(width: 42, height: 42)
                VStack(alignment: .leading, spacing: 5) {
                    Text(title)
                        .font(.system(size: 24, weight: .semibold))
                    Text(subtitle)
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            content
                .padding(.top, 24)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
        .padding(.horizontal, 34)
        .padding(.top, 26)
        .padding(.bottom, 22)
    }
}

private struct OnboardingBackdrop: View {
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        ZStack {
            colorScheme == .dark ? CodeWideBrand.graphite : CodeWideBrand.warmWhite
            LinearGradient(
                colors: [
                    CodeWideBrand.accent.opacity(colorScheme == .dark ? 0.24 : 0.16),
                    Color.clear,
                    CodeWideBrand.accent.opacity(colorScheme == .dark ? 0.10 : 0.07),
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            Circle()
                .fill(CodeWideBrand.accent.opacity(colorScheme == .dark ? 0.22 : 0.14))
                .frame(width: 320, height: 320)
                .blur(radius: 90)
                .offset(x: 260, y: -190)
        }
        .ignoresSafeArea()
    }
}

private struct AppServerStateLabel: View {
    let state: AppServerState

    var body: some View {
        HStack(spacing: 5) {
            Circle()
                .fill(color)
                .frame(width: 7, height: 7)
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private var title: String {
        switch state {
        case let .available(version):
            version ?? "Available"
        case .unavailable:
            "Unavailable"
        }
    }

    private var color: Color {
        switch state {
        case .available: .green
        case .unavailable: .secondary
        }
    }
}

struct ShimmerText: View {
    private let text: String

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(_ text: String) {
        self.text = text
    }

    var body: some View {
        if reduceMotion {
            Text(text)
                .foregroundStyle(.secondary)
        } else {
            TimelineView(.animation(minimumInterval: 1.0 / 30.0)) { context in
                let phase = context.date.timeIntervalSinceReferenceDate
                    .truncatingRemainder(dividingBy: 1.4) / 1.4
                Text(text)
                    .foregroundStyle(
                        LinearGradient(
                            colors: [
                                Color.secondary,
                                Color.primary.opacity(0.95),
                                Color.secondary,
                            ],
                            startPoint: UnitPoint(x: phase * 2.0 - 1.0, y: 0.5),
                            endPoint: UnitPoint(x: phase * 2.0, y: 0.5)
                        )
                    )
            }
        }
    }
}

private extension String {
    var abbreviatingWithTilde: String {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        guard hasPrefix(home) else { return self }
        return "~" + String(dropFirst(home.count))
    }
}
