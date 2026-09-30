import CodeWideShared
import SwiftUI

struct SetupActions {
    var primary: () -> Void = {}
    var back: () -> Void = {}
    var finish: () -> Void = {}
    var scan: () -> Void = {}
    var selectProfile: (AppServerPayload) -> Void = { _ in }
    var selectEndpoint: (String) -> Void = { _ in }
    var newPairing: () -> Void = {}
    var copyPairing: () -> Void = {}
    var navigate: (SetupStep) -> Void = { _ in }
    var useDirect: () -> Void = {}
    var setupRelay: () -> Void = {}
    var enableRelay: () -> Void = {}
}

/// Pure setup presentation; previews never register a helper or create a link.
struct SetupView: View {
    let snapshot: SetupSnapshot
    let actions: SetupActions

    @State private var showsError = false

    var body: some View {
        NavigationSplitView {
            List(selection: stepSelection) {
                Section {
                    ForEach(SetupStep.allCases) { step in
                        HStack {
                            Label(step.title, systemImage: step.symbol)
                            Spacer(minLength: 4)
                            if step.rawValue < snapshot.step.rawValue {
                                Image(systemName: "checkmark").foregroundStyle(.secondary)
                                    .accessibilityHidden(true)
                            }
                        }
                        .tag(step)
                        .disabled(!snapshot.canNavigate(to: step))
                        .accessibilityLabel("Step \(step.rawValue + 1) of 3, \(step.title)")
                    }
                }
            }
            .listStyle(.sidebar)
            .navigationTitle("Set Up CodeWide")
            .navigationSplitViewColumnWidth(156)
        } detail: {
            VStack(spacing: 0) {
                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        switch snapshot.step {
                        case .mac: macPage
                        case .relay: relayPage
                        case .phone: phonePage
                        }
                        if let error = snapshot.error { errorDetails(error) }
                    }
                    .padding(22)
                    .frame(maxWidth: .infinity, alignment: .topLeading)
                }
                .scrollBounceBehavior(.basedOnSize)
                footer
            }
            .frame(minWidth: 460)
        }
        .navigationSplitViewStyle(.balanced)
        .toolbar(removing: .sidebarToggle)
        .frame(minWidth: 640, minHeight: 420)
        .tint(CodeWideBrand.actionAccent)
    }

    private var stepSelection: Binding<SetupStep?> {
        Binding(get: { snapshot.step }, set: { destination in
            guard let destination, snapshot.canNavigate(to: destination) else { return }
            actions.navigate(destination)
        })
    }

    @ViewBuilder private var macPage: some View {
        pageTitle(snapshot.profileToConnect == nil ? snapshot.macState.title : "Connect Codex",
                  subtitle: snapshot.profileToConnect == nil ? snapshot.macState.explanation
                    : "CodeWide found Codex on this Mac. Connect it to use Codex from your phone.")

        if snapshot.showsProfilePicker {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Text("Codex profile").font(.subheadline.weight(.medium))
                    Spacer()
                    scanButton
                }.foregroundStyle(.secondary)
                Picker("Codex profile", selection: profileSelection) {
                    ForEach(snapshot.profiles, id: \.id) { profile in
                        HStack(spacing: 8) {
                            Text(profile.displayName)
                            Text(profile.selected && profile.state.isAvailable ? "In use" : profile.state.isAvailable ? "Available" : "Not running")
                                .foregroundStyle(.secondary)
                        }
                        .tag(Optional(profile.id))
                        .disabled(!profile.state.isAvailable)
                        .help(profile.codexHome)
                    }
                }
                .pickerStyle(.radioGroup)
                .labelsHidden()
                .disabled(snapshot.isWorking || ![.ready, .chooseProfile].contains(snapshot.macState))
                .padding(.vertical, 8)
            }
        } else if snapshot.macState == .ready {
            codexConnection
        } else {
            statusContent
        }

        if let versionNote {
            Text(versionNote).font(.system(size: 12)).foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }

        Label("Your projects stay on this Mac.", systemImage: "lock.shield")
            .font(.system(size: 12))
            .foregroundStyle(.secondary)

    }

    private var codexConnection: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 10) {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(.green)
                    .accessibilityHidden(true)
                Text("Connected to Codex").font(.subheadline.weight(.medium))
                Spacer()
                scanButton
            }
            if let profile = snapshot.profiles.first(where: \.selected) {
                if let version = profile.state.version {
                    LabeledContent("Codex version", value: version)
                        .font(.system(size: 12)).foregroundStyle(.secondary)
                }
                DisclosureGroup("Connection details") {
                    VStack(alignment: .leading, spacing: 8) {
                        LabeledContent("Profile", value: profile.displayName)
                        Text(profile.codexHome).textSelection(.enabled)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(.top, 8)
                }
                .font(.system(size: 12)).foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 8)
    }

    private var profileSelection: Binding<String?> {
        Binding(get: { snapshot.profiles.first(where: \.selected)?.id }, set: { id in
            guard !snapshot.isWorking, [.ready, .chooseProfile].contains(snapshot.macState),
                  let profile = snapshot.profiles.first(where: { $0.id == id }),
                  profile.state.isAvailable, !profile.selected else { return }
            actions.selectProfile(profile)
        })
    }

    private var statusContent: some View {
        HStack(alignment: .center, spacing: 16) {
            Image(systemName: statusSymbol)
                .font(.system(size: 30, weight: .light))
                .frame(width: 48, height: 56)
                .foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 6) {
                if snapshot.macState == .checking {
                    ShimmerText("Codex connection").font(.system(size: 14, weight: .medium))
                } else {
                    Text(statusTitle).font(.system(size: 14, weight: .medium))
                }
                Text(statusSubtitle).font(.system(size: 12)).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
            if snapshot.macState != .permissionRequired && snapshot.macState != .helperUnavailable {
                scanButton
            }
        }
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var scanButton: some View {
        Button(action: actions.scan) {
            Label {
                if snapshot.isDiscovering { ShimmerText("Scan Again") }
                else { Text("Scan Again") }
            } icon: { Image(systemName: "arrow.clockwise") }
        }
        .font(.system(size: 11))
        .buttonStyle(.glass)
        .tint(nil as Color?)
        .controlSize(.small)
        .disabled(snapshot.isDiscovering || snapshot.isWorking)
    }

    @ViewBuilder private var phonePage: some View {
        if snapshot.macState != .ready {
            pageTitle("Reconnect to Codex", subtitle: "The Codex connection changed. Go back to the Codex step to reconnect before adding your phone.")
            Image(systemName: "desktopcomputer.trianglebadge.exclamationmark")
                .font(.system(size: 48, weight: .light)).foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, minHeight: 160)
        } else if let device = snapshot.device {
            pageTitle("You're all set", subtitle: "You'll find CodeWide in the menu bar whenever you need it.")
            VStack(spacing: 18) {
                Image(systemName: "checkmark")
                    .font(.system(size: 29, weight: .medium))
                    .foregroundStyle(.green)
                    .frame(width: 74, height: 74)
                    .glassEffect(.regular, in: .circle)
                Text(device.name).font(.system(size: 20, weight: .semibold)).lineLimit(2)
                Text(device.activeConnections > 0 ? "Connected to this Mac" : "Paired. Open CodeWide on your phone to connect.")
                    .font(.system(size: 13)).foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 18)
        } else if snapshot.route == .relay && !snapshot.canPair {
            pageTitle("Connect with Relay", subtitle: "Reach this Mac from another network. Connect your Relay to create a QR code for your phone.")
            relayConnection
        } else if !snapshot.canPair {
            pageTitle("Connect to a network", subtitle: "Your Mac needs a Wi-Fi, Ethernet, or VPN address your phone can reach.")
            Label("No reachable address is available on this Mac.", systemImage: "wifi.slash")
                .font(.system(size: 13)).foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, minHeight: 140)
        } else {
            pageTitle("Connect your phone", subtitle: "Scan this code from the CodeWide app on your phone.")
            HStack(alignment: .top, spacing: 24) {
                pairingCode
                VStack(alignment: .leading, spacing: 16) {
                    Text("On your phone").font(.subheadline.weight(.semibold))
                    Text("Open CodeWide and choose the option to connect a Companion.")
                        .font(.system(size: 12)).foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                    Divider()
                    Label(snapshot.route == .direct ? "Direct connection" : "Via Relay", systemImage: snapshot.route.symbol)
                        .font(.system(size: 12, weight: .medium))
                    Text(snapshot.route == .direct ? "Use the same network or VPN." : "Keep this Mac and your Relay online.")
                        .font(.system(size: 12)).foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                    if snapshot.route == .direct { addressPicker }
                    else {
                        Text(Self.displayAddress(snapshot.relay?.publicEndpoint ?? ""))
                            .font(.system(size: 11).monospacedDigit()).foregroundStyle(.secondary)
                            .textSelection(.enabled)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Button("Change connection…") { actions.navigate(.relay) }
                        .buttonStyle(.link)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, 4)
            }
        }
    }

    @ViewBuilder private var relayPage: some View {
        pageTitle("Connect from anywhere", subtitle: "A Relay lets your phone reach this Mac outside your local network. You can also continue with a direct connection.")
        VStack(alignment: .leading, spacing: 12) {
            LabeledContent("Relay", value: snapshot.relayIsReady ? "Connected" : relayIsDisabled ? "Disabled" : "Not connected")
            if let endpoint = snapshot.relay?.publicEndpoint {
                LabeledContent("Address", value: Self.displayAddress(endpoint))
            }
        }
        .font(.system(size: 13))
        .padding(.vertical, 8)
        if snapshot.relay?.configured == true {
            Button("Change Relay…", action: actions.setupRelay).buttonStyle(.glass).tint(nil as Color?)
        } else {
            Text("Open pairing on your Relay, then connect it to this Mac. You'll confirm the same symbols on both devices.")
                .font(.system(size: 13)).foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        Label("Direct connection works on the same network or VPN.", systemImage: "wifi")
            .font(.system(size: 12)).foregroundStyle(.secondary)
    }

    private var relayConnection: some View {
        HStack(alignment: .center, spacing: 12) {
            Image(systemName: "network")
                .font(.system(size: 22)).foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 4) {
                Text("Relay").font(.system(size: 13, weight: .semibold))
                Text(relaySummary).font(.system(size: 11)).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 8)
            Button(relayButtonTitle, action: relayIsDisabled ? actions.enableRelay : actions.setupRelay)
                .buttonStyle(.glass)
                .buttonBorderShape(.capsule)
                .tint(nil as Color?)
                .disabled(snapshot.isWorking)
        }
    }

    private var relayIsDisabled: Bool {
        snapshot.relay?.configured == true && snapshot.relay?.enabled != true
    }

    private var relayButtonTitle: String {
        if relayIsDisabled { return "Enable Relay" }
        return snapshot.relay?.configured == true ? "Change Relay…" : "Set Up Relay…"
    }

    private var relaySummary: String {
        guard let relay = snapshot.relay, relay.configured else {
            return "Optional. Reach this Mac outside your Wi-Fi or VPN."
        }
        let address = Self.displayAddress(relay.publicEndpoint ?? "")
        if !relay.enabled { return "Off · \(address)" }
        return relay.connection == "online" ? "Connected · \(address)" : "Connection unavailable · \(address)"
    }

    private var pairingCode: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            let usable = snapshot.pairingIsUsable(at: context.date)
            VStack(spacing: 12) {
                Group {
                    if usable, let pairing = snapshot.pairing {
                        PairingQRCode(value: pairing.link)
                            .padding(12)
                            .background(.white, in: RoundedRectangle(cornerRadius: 18))
                            .accessibilityLabel("One-time CodeWide pairing QR code")
                    } else {
                        VStack(spacing: 12) {
                            Image(systemName: "qrcode").font(.system(size: 42, weight: .light))
                            if snapshot.isCreatingPairing {
                                ShimmerText("Secure QR code")
                            } else {
                                Text(snapshot.pairingError == nil ? "Code expired" : "QR unavailable")
                            }
                        }
                        .font(.system(size: 12))
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 18))
                    }
                }.frame(width: 208, height: 208)

                if usable, let pairing = snapshot.pairing {
                    Text("Expires at \(Date(timeIntervalSince1970: Double(pairing.expiresAtUnixMilliseconds) / 1_000).formatted(date: .omitted, time: .shortened))")
                        .font(.system(size: 11)).foregroundStyle(.secondary)
                } else {
                    Text(snapshot.pairingError == nil ? "One-time, secure connection" : "Try creating a new code.")
                        .font(.system(size: 11)).foregroundStyle(.secondary)
                }
                GlassEffectContainer(spacing: 8) {
                    HStack(spacing: 8) {
                        Button("Copy Link", action: actions.copyPairing)
                            .disabled(!usable)
                        Button("New Code", action: actions.newPairing)
                            .disabled(snapshot.isCreatingPairing)
                    }
                    .buttonStyle(.glass)
                    .tint(nil as Color?)
                    .controlSize(.small)
                }
            }
        }
    }

    private var addressPicker: some View {
        VStack(alignment: .leading, spacing: 8) {
            Menu {
                ForEach(snapshot.endpoints, id: \.self) { endpoint in
                    Button { actions.selectEndpoint(endpoint) } label: {
                        if endpoint == snapshot.selectedEndpoint {
                            Label(Self.displayAddress(endpoint), systemImage: "checkmark")
                        } else { Text(Self.displayAddress(endpoint)) }
                    }
                }
            } label: {
                Label(Self.displayAddress(snapshot.selectedEndpoint ?? ""), systemImage: "network")
                    .font(.system(size: 11).monospacedDigit())
            }
            .menuStyle(.borderlessButton)
            .lineLimit(1)
            .truncationMode(.middle)
            .help("Choose the Mac address your phone can reach.")
            .accessibilityLabel("Mac network address")
            if let error = snapshot.pairingError { errorDetails(error) }
        }
    }

    private var footer: some View {
        GlassEffectContainer(spacing: 12) {
            HStack(spacing: 12) {
                if snapshot.step != .mac {
                    Button("Back", systemImage: "chevron.left", action: actions.back)
                        .buttonStyle(.glass)
                        .tint(nil as Color?)
                }
                Spacer()
                if snapshot.step == .relay && snapshot.macState == .ready {
                    Button("Use Direct", action: actions.useDirect)
                        .buttonStyle(.glass).tint(nil as Color?)
                        .disabled(snapshot.isWorking)
                }
                if snapshot.step == .phone && snapshot.device == nil && snapshot.macState == .ready {
                    Button("Set Up Later", action: actions.finish).buttonStyle(.glass).tint(nil as Color?)
                } else {
                    Button(action: actions.primary) {
                        HStack(spacing: 8) {
                            if snapshot.isWorking || snapshot.step == .mac && snapshot.macState == .checking {
                                ShimmerText(primaryTitle)
                            } else { Text(primaryTitle) }
                            if snapshot.step == .mac && snapshot.macState == .ready {
                                Image(systemName: "arrow.right")
                            }
                        }.frame(minWidth: 94)
                    }
                    .buttonStyle(.glassProminent)
                    .keyboardShortcut(.defaultAction)
                    .disabled(snapshot.isWorking || snapshot.step == .mac && !snapshot.canPerformPrimaryAction)
                }
            }
            .controlSize(.regular)
            .buttonBorderShape(.capsule)
        }
        .padding(.horizontal, 22)
        .padding(.vertical, 14)
    }

    private var primaryTitle: String {
        if snapshot.step == .mac {
            return snapshot.profileToConnect != nil ? "Connect Codex" : snapshot.macState.primaryTitle
        }
        if snapshot.macState != .ready { return "Back to Codex" }
        if snapshot.step == .relay {
            if snapshot.relayIsReady { return "Continue" }
            return relayIsDisabled ? "Enable Relay" : "Set Up Relay…"
        }
        if snapshot.device != nil { return "Finish Setup" }
        return "Try Again"
    }

    private func pageTitle(_ title: String, subtitle: String) -> some View {
        VStack(alignment: .leading, spacing: 9) {
            Text(title).font(.system(size: 21, weight: .semibold)).tracking(-0.3)
            Text(subtitle).font(.system(size: 13)).foregroundStyle(.secondary)
                .lineSpacing(3).fixedSize(horizontal: false, vertical: true)
        }
    }

    private func errorDetails(_ error: String) -> some View {
        DisclosureGroup(isExpanded: $showsError) {
            Text(error).font(.system(size: 11)).textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
        } label: {
            Label("Connection details", systemImage: "exclamationmark.circle")
                .font(.system(size: 12))
        }.tint(.secondary)
    }

    static func displayAddress(_ endpoint: String) -> String {
        guard let url = URL(string: endpoint), let host = url.host else { return "Mac address" }
        return url.port.map { "\(host):\($0)" } ?? host
    }

    private var statusSymbol: String {
        switch snapshot.macState {
        case .permissionRequired: "switch.2"
        case .helperUnavailable: "desktopcomputer.trianglebadge.exclamationmark"
        case .installCodex, .updateCodex: "square.and.arrow.down"
        default: "terminal"
        }
    }

    private var statusTitle: String {
        switch snapshot.macState {
        case .permissionRequired: "Background access is off"
        case .helperUnavailable: "Background service unavailable"
        case .installCodex: "Codex CLI is required"
        case .updateCodex: "A newer Codex version is required"
        case .startCodex: "Codex is installed"
        case .chooseProfile: "Codex is available"
        default: "Codex isn't connected"
        }
    }

    private var statusSubtitle: String {
        switch snapshot.macState {
        case .permissionRequired: "System Settings → General → Login Items"
        case .helperUnavailable: "Your profiles and devices are preserved."
        case .checking: "Looking for Codex on this Mac."
        case .startCodex: "Start Codex to make it available to CodeWide."
        case .chooseProfile: "Ready to connect on this Mac."
        default: "Scan again after installing or starting Codex."
        }
    }

    private var versionNote: String? {
        switch snapshot.installation {
        case let .updateRequired(installedVersion, minimumVersion):
            "Installed: \(installedVersion) · Required: \(minimumVersion) or later"
        case let .notFound(minimumVersion), let .unverified(minimumVersion):
            "Requires Codex \(minimumVersion) or later."
        default: nil
        }
    }
}
