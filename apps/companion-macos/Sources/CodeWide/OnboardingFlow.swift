import AppKit
import CodeWideShared
import SwiftUI

private enum OnboardingStep: Int, CaseIterable, Identifiable, Equatable {
    case companion
    case relay
    case device
    case done

    var id: Int { rawValue }

    var title: String {
        switch self {
        case .companion: "Companion"
        case .relay: "Relay"
        case .device: "Device"
        case .done: "Done"
        }
    }
}

private enum RelayChoice: Equatable {
    case local
    case relay
}

struct OnboardingFlow: View {
    @ObservedObject var runtime: RuntimeConnection
    let finish: @MainActor () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var step = OnboardingStep.companion
    @State private var relayChoice = RelayChoice.relay
    @State private var relayAddress = ""
    @State private var relayInvitation = ""
    @State private var relayError: String?
    @State private var relayActionInProgress = false
    @State private var pairing: PairingPayload?
    @State private var pairingError: String?

    var body: some View {
        ZStack {
            CodeWideBrandBackdrop()
            HStack(spacing: 14) {
                stepRail
                VStack(spacing: 0) {
                    ZStack {
                        page
                            .id(step)
                            .transition(pageTransition)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    footer
                }
            }
            .padding(14)
        }
        .frame(minWidth: 700, minHeight: 460)
        .tint(CodeWideBrand.accent)
        .onAppear {
            if runtime.relay?.configured == true {
                relayChoice = .relay
            }
        }
        .task(id: step) {
            guard
                step == .device,
                pairing == nil,
                runtime.relay?.connection == "online"
            else {
                return
            }
            do {
                pairing = try await runtime.createPairing()
                pairingError = nil
            } catch {
                pairingError = error.localizedDescription
            }
        }
    }

    private var stepRail: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 9) {
                CodeWideBrandMark(size: 25)
                Text("CodeWide")
                    .font(.headline)
            }
                .padding(.bottom, 20)

            GlassEffectContainer(spacing: 8) {
                VStack(spacing: 4) {
                    ForEach(OnboardingStep.allCases) { candidate in
                        Button {
                            guard candidate.rawValue <= step.rawValue else { return }
                            move(to: candidate)
                        } label: {
                            HStack(spacing: 9) {
                                stepMarker(candidate)
                                Text(candidate.title)
                                    .foregroundStyle(candidate == step ? .primary : .secondary)
                                Spacer()
                            }
                            .padding(.horizontal, 9)
                            .padding(.vertical, 8)
                            .contentShape(Rectangle())
                            .glassEffect(
                                candidate == step
                                    ? .regular.tint(CodeWideBrand.accent.opacity(0.18)).interactive()
                                    : .identity,
                                in: .rect(cornerRadius: 12)
                            )
                        }
                        .buttonStyle(.plain)
                        .disabled(candidate.rawValue > step.rawValue)
                    }
                }
            }

            Spacer()
            Text("Everything can be changed later from the menu bar.")
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(18)
        .frame(width: 190)
        .glassEffect(.regular, in: .rect(cornerRadius: 26))
    }

    @ViewBuilder
    private func stepMarker(_ candidate: OnboardingStep) -> some View {
        ZStack {
            Circle()
                .fill(markerFill(candidate))
                .frame(width: 23, height: 23)
            if candidate.rawValue < step.rawValue {
                Image(systemName: "checkmark")
                    .font(.caption2.bold())
                    .foregroundStyle(.green)
            } else {
                Text("\(candidate.rawValue + 1)")
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(candidate == step ? CodeWideBrand.warmWhite : Color.secondary)
            }
        }
    }

    private func markerFill(_ candidate: OnboardingStep) -> Color {
        if candidate == step {
            return CodeWideBrand.accent
        }
        if candidate.rawValue < step.rawValue {
            return .green.opacity(0.13)
        }
        return Color(nsColor: .separatorColor).opacity(0.35)
    }

    @ViewBuilder
    private var page: some View {
        switch step {
        case .companion:
            companionPage
        case .relay:
            relayPage
        case .device:
            devicePage
        case .done:
            donePage
        }
    }

    private var companionPage: some View {
        OnboardingPage(
            title: "Your Companion lives on this Mac",
            subtitle: "CodeWide keeps the runtime local and starts it automatically in the background."
        ) {
            VStack(spacing: 20) {
                ConnectionNode(
                    symbol: "desktopcomputer",
                    label: "This Mac",
                    active: runtime.health != nil
                )
                RuntimeStatusView(runtime: runtime)
                if runtime.requiresApproval {
                    Button("Open Login Items Settings") {
                        runtime.openLoginItemsSettings()
                    }
                    .buttonStyle(.glass)
                }
            }
        }
    }

    private var relayPage: some View {
        OnboardingPage(
            title: "How should devices reach it?",
            subtitle: "Relay is optional. Add it for remote access, or keep the Companion local for now."
        ) {
            VStack(spacing: 14) {
                GlassEffectContainer(spacing: 12) {
                    HStack(spacing: 12) {
                        RelayChoiceCard(
                            title: "Local only",
                            detail: "Skip Relay and finish setup later.",
                            symbol: "laptopcomputer",
                            selected: relayChoice == .local
                        ) {
                            relayChoice = .local
                        }
                        RelayChoiceCard(
                            title: "Add Relay",
                            detail: "Connect devices from anywhere.",
                            symbol: "antenna.radiowaves.left.and.right",
                            selected: relayChoice == .relay
                        ) {
                            relayChoice = .relay
                        }
                    }
                }

                if relayChoice == .relay {
                    relayForm
                        .transition(.move(edge: .top).combined(with: .opacity))
                }
            }
            .animation(
                reduceMotion ? nil : .spring(response: 0.42, dampingFraction: 0.84),
                value: relayChoice
            )
        }
    }

    private var relayForm: some View {
        VStack(alignment: .leading, spacing: 9) {
            if runtime.relay?.configured == true {
                HStack {
                    StatusLabel(
                        text: runtime.relay?.connection == "online"
                            ? "Relay online"
                            : "\(relayStatusTitle) · retrying",
                        color: runtime.relay?.connection == "online" ? .green : .orange
                    )
                    Spacer()
                    if runtime.relay?.enabled == false {
                        Button("Enable") {
                            setRelayEnabled()
                        }
                        .buttonStyle(.glass)
                        .disabled(relayActionInProgress)
                    }
                }
                if let endpoint = runtime.relay?.publicEndpoint {
                    Text(endpoint)
                        .font(.caption.monospaced())
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
            } else {
                TextField("relay.example.com:8780", text: $relayAddress)
                    .textFieldStyle(.roundedBorder)
                TextEditor(text: $relayInvitation)
                    .font(.callout.monospaced())
                    .frame(height: 66)
                    .overlay {
                        RoundedRectangle(cornerRadius: 6)
                            .stroke(Color(nsColor: .separatorColor))
                    }
                HStack {
                    Text("Paste the JSON invitation from `codewide-relay invite`.")
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
            }
            if let relayError {
                Text(relayError)
                    .font(.caption)
                    .foregroundStyle(.red)
            }
        }
        .padding(12)
        .glassEffect(.regular, in: .rect(cornerRadius: 16))
    }

    private var devicePage: some View {
        OnboardingPage(
            title: "Connect your first device",
            subtitle: "Scan the one-time code in CodeWide. The screen updates as soon as the device connects."
        ) {
            if let connectedDevice = runtime.devices.first {
                VStack(spacing: 17) {
                    ConnectionDiagram(deviceName: connectedDevice.name, connected: true)
                    StatusLabel(text: "\(connectedDevice.name) paired", color: .green)
                }
                .transition(.scale(scale: 0.96).combined(with: .opacity))
            } else if let pairing {
                VStack(spacing: 14) {
                    HStack(spacing: 18) {
                        PairingQRCode(value: pairing.link)
                            .frame(width: 154, height: 154)
                            .padding(10)
                            .background(CodeWideBrand.warmWhite, in: RoundedRectangle(cornerRadius: 14))
                            .shadow(color: .black.opacity(0.12), radius: 18, y: 10)
                        ConnectionLine(active: true)
                            .frame(width: 76)
                        ConnectionNode(
                            symbol: "iphone",
                            label: "Your device",
                            active: true
                        )
                    }
                    StatusLabel(text: "Waiting for device…", color: .orange)
                }
            } else {
                VStack(spacing: 12) {
                    ProgressView()
                        .controlSize(.large)
                    Text(pairingError ?? "Creating a secure pairing code…")
                        .font(.callout)
                        .foregroundStyle(pairingError == nil ? Color.secondary : Color.red)
                    if pairingError != nil {
                        Button("Try Again") {
                            pairing = nil
                            pairingError = nil
                            Task {
                                do {
                                    pairing = try await runtime.createPairing()
                                } catch {
                                    pairingError = error.localizedDescription
                                }
                            }
                        }
                        .buttonStyle(.glass)
                    }
                }
            }
        }
        .animation(
            reduceMotion ? nil : .spring(response: 0.46, dampingFraction: 0.82),
            value: runtime.devices.count
        )
    }

    private var donePage: some View {
        OnboardingPage(
            title: "CodeWide is ready",
            subtitle: "Companion stays available in the background. Relay and devices remain manageable from the menu bar."
        ) {
            ZStack {
                Image(systemName: "checkmark")
                    .font(.system(size: 48, weight: .medium))
                    .foregroundStyle(CodeWideBrand.warmWhite)
            }
            .frame(width: 132, height: 132)
            .glassEffect(
                .regular.tint(CodeWideBrand.accent.opacity(0.34)),
                in: .rect(cornerRadius: 42)
            )
            .shadow(color: CodeWideBrand.accent.opacity(0.26), radius: 28, y: 16)
            .transition(.scale(scale: 0.7).combined(with: .opacity))
        }
    }

    private var footer: some View {
        HStack(spacing: 10) {
            Button("Skip Setup") {
                finish()
            }
            .buttonStyle(.glass)

            Spacer()

            Button("Back") {
                guard let previous = OnboardingStep(rawValue: step.rawValue - 1) else { return }
                move(to: previous)
            }
            .buttonStyle(.glass)
            .disabled(step == .companion)

            if step == .device && runtime.devices.isEmpty {
                Button("Pair Later") {
                    move(to: .done)
                }
                .buttonStyle(.glass)
            }

            Button(step == .done ? "Finish" : "Continue") {
                advance()
            }
            .buttonStyle(.glassProminent)
            .disabled(!canContinue)
        }
        .padding(.horizontal, 24)
        .padding(.vertical, 12)
    }

    private var canContinue: Bool {
        switch step {
        case .companion:
            runtime.health != nil
        case .relay:
            relayChoice == .local || runtime.relay?.connection == "online"
        case .device:
            !runtime.devices.isEmpty
        case .done:
            true
        }
    }

    private var pageTransition: AnyTransition {
        .asymmetric(
            insertion: .move(edge: .trailing).combined(with: .opacity),
            removal: .move(edge: .leading).combined(with: .opacity)
        )
    }

    private func advance() {
        if step == .done {
            finish()
            return
        }
        if step == .relay && relayChoice == .local {
            move(to: .done)
            return
        }
        guard let next = OnboardingStep(rawValue: step.rawValue + 1) else { return }
        move(to: next)
    }

    private func move(to destination: OnboardingStep) {
        withAnimation(reduceMotion ? nil : .spring(response: 0.44, dampingFraction: 0.86)) {
            step = destination
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
            } catch {
                relayError = error.localizedDescription
            }
        }
    }

    private var relayStatusTitle: String {
        switch runtime.relay?.connection {
        case "connecting": "Connecting"
        case "reconnecting": "Relay unreachable"
        case "disabled": "Relay disabled"
        default: "Relay unavailable"
        }
    }

    private func setRelayEnabled() {
        guard !relayActionInProgress else { return }
        relayActionInProgress = true
        relayError = nil
        Task {
            defer { relayActionInProgress = false }
            do {
                try await runtime.setRelayEnabled(true)
            } catch {
                relayError = error.localizedDescription
            }
        }
    }
}

private struct OnboardingPage<Content: View>: View {
    let title: String
    let subtitle: String
    let content: Content

    init(
        title: String,
        subtitle: String,
        @ViewBuilder content: () -> Content
    ) {
        self.title = title
        self.subtitle = subtitle
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(title)
                .font(.system(size: 25, weight: .semibold))
            Text(subtitle)
                .font(.callout)
                .foregroundStyle(.secondary)
                .padding(.top, 7)
                .fixedSize(horizontal: false, vertical: true)
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .padding(.horizontal, 36)
        .padding(.top, 34)
        .padding(.bottom, 20)
    }
}

private struct RelayChoiceCard: View {
    let title: String
    let detail: String
    let symbol: String
    let selected: Bool
    let action: @MainActor () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 7) {
                Image(systemName: symbol)
                    .font(.title2)
                    .foregroundStyle(selected ? CodeWideBrand.accent : Color.secondary)
                Spacer()
                Text(title)
                    .font(.headline)
                    .foregroundStyle(.primary)
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, minHeight: 92, alignment: .leading)
            .padding(14)
            .glassEffect(
                .regular
                    .tint(selected ? CodeWideBrand.accent.opacity(0.22) : nil)
                    .interactive(),
                in: .rect(cornerRadius: 20)
            )
        }
        .buttonStyle(.plain)
    }
}

private struct RuntimeStatusView: View {
    @ObservedObject var runtime: RuntimeConnection

    var body: some View {
        if runtime.requiresApproval {
            StatusLabel(text: "Approval required in Login Items", color: .orange)
        } else if runtime.health != nil {
            StatusLabel(text: "Companion is running", color: .green)
        } else {
            HStack(spacing: 8) {
                ProgressView()
                    .controlSize(.small)
                Text(runtime.status)
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
        }
    }
}

private struct StatusLabel: View {
    let text: String
    let color: Color

    var body: some View {
        Label {
            Text(text)
        } icon: {
            Circle()
                .fill(color)
                .frame(width: 8, height: 8)
                .shadow(color: color.opacity(0.35), radius: 5)
        }
        .font(.callout)
        .foregroundStyle(color)
    }
}

private struct ConnectionDiagram: View {
    let deviceName: String
    let connected: Bool

    var body: some View {
        GlassEffectContainer(spacing: 14) {
            HStack(spacing: 14) {
                ConnectionNode(symbol: "desktopcomputer", label: "This Mac", active: connected)
                ConnectionLine(active: connected)
                    .frame(width: 72)
                ConnectionNode(symbol: "network", label: "Relay", active: connected)
                ConnectionLine(active: connected)
                    .frame(width: 72)
                ConnectionNode(symbol: "iphone", label: deviceName, active: connected)
            }
        }
    }
}

private struct ConnectionNode: View {
    let symbol: String
    let label: String
    let active: Bool

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: symbol)
                .font(.system(size: 27, weight: .regular))
                .foregroundStyle(active ? CodeWideBrand.accent : Color.secondary)
            .frame(width: 78, height: 78)
            .glassEffect(
                .regular.tint(active ? CodeWideBrand.accent.opacity(0.14) : nil),
                in: .rect(cornerRadius: 22)
            )
            .shadow(color: active ? CodeWideBrand.accent.opacity(0.14) : .clear, radius: 18)
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
    }
}

private struct ConnectionLine: View {
    let active: Bool

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var moves = false

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .leading) {
                Capsule()
                    .fill(Color(nsColor: .separatorColor))
                    .frame(height: 2)
                if active {
                    Circle()
                        .fill(CodeWideBrand.accent)
                        .frame(width: 7, height: 7)
                        .shadow(color: CodeWideBrand.accent.opacity(0.45), radius: 4)
                        .offset(x: moves ? max(0, proxy.size.width - 7) : 0)
                }
            }
            .frame(maxHeight: .infinity)
        }
        .frame(height: 8)
        .onAppear {
            guard active, !reduceMotion else { return }
            withAnimation(.linear(duration: 1.35).repeatForever(autoreverses: false)) {
                moves = true
            }
        }
    }
}
