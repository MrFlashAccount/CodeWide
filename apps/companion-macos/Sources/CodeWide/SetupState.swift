import CodeWideShared
import Foundation

enum SetupStep: Int, CaseIterable, Identifiable {
    case mac, relay, phone
    var id: Int { rawValue }
    var title: String {
        switch self { case .mac: "Codex"; case .relay: "Relay"; case .phone: "Your phone" }
    }
    var symbol: String {
        switch self { case .mac: "terminal"; case .relay: "network"; case .phone: "iphone" }
    }
}

enum SetupMacState: Equatable {
    case checking, permissionRequired, helperUnavailable, chooseProfile, ready
    case startCodex, installCodex, updateCodex, retryDiscovery

    init(health: RuntimeHealthPayload?, server: AppServerPayload?,
         servers: [AppServerPayload], installation: CodexInstallationState?,
         requiresApproval: Bool, runtimeStatus: String,
         isDiscovering: Bool, hasDiscovered: Bool) {
        if requiresApproval { self = .permissionRequired }
        else if health == nil {
            self = runtimeStatus == "Starting" || runtimeStatus == "Switching App Server"
                ? .checking : .helperUnavailable
        } else if health?.phase != "running" { self = .helperUnavailable }
        else if server?.state.isAvailable == true { self = .ready }
        else if isDiscovering || !hasDiscovered { self = .checking }
        else if servers.contains(where: { $0.state.isAvailable }) { self = .chooseProfile }
        else {
            switch installation {
            case .ready:
                self = servers.contains(where: { $0.selected }) ? .startCodex : .retryDiscovery
            case .notFound: self = .installCodex
            case .updateRequired: self = .updateCodex
            case .unverified, nil: self = .retryDiscovery
            }
        }
    }

    var title: String {
        switch self {
        case .checking: "Connect Codex"
        case .chooseProfile: "Choose your Codex profile"
        case .ready: "Codex is ready"
        case .permissionRequired: "Keep CodeWide available"
        case .helperUnavailable: "Reconnect to Codex"
        case .startCodex: "Start Codex on this Mac"
        case .installCodex: "Install Codex to continue"
        case .updateCodex: "Update Codex to continue"
        case .retryDiscovery: "Find Codex on this Mac"
        }
    }

    var explanation: String {
        switch self {
        case .checking:
            "CodeWide looks for Codex on this Mac so you can use it from your phone."
        case .chooseProfile:
            "Choose the Codex profile you want to use from your phone."
        case .ready:
            "CodeWide is connected to Codex on this Mac. Next, choose how your phone will connect."
        case .permissionRequired:
            "Allow CodeWide in Login Items so your phone can connect while the app is in the background."
        case .helperUnavailable:
            "CodeWide's background service isn't responding. Reconnect to continue setup."
        case .startCodex:
            "Codex is installed. Start its App Server to make this profile available to your phone."
        case .installCodex:
            "Install and sign in to the Codex CLI, then return here and scan again."
        case .updateCodex:
            "This version of Codex is too old. Update the CLI, then return here and scan again."
        case .retryDiscovery:
            "Check that Codex is installed and signed in, then scan for its profiles again."
        }
    }

    var primaryTitle: String {
        switch self {
        case .checking, .chooseProfile, .ready: "Continue"
        case .permissionRequired: "Open Login Items"
        case .helperUnavailable, .retryDiscovery: "Try Again"
        case .startCodex: "Start Codex"
        case .installCodex, .updateCodex: "Open Codex Guide"
        }
    }

    var canPerformPrimaryAction: Bool { self != .checking && self != .chooseProfile }
}

struct SetupSnapshot {
    var step: SetupStep = .mac
    var macState: SetupMacState = .checking
    var profiles: [AppServerPayload] = []
    var installation: CodexInstallationState?
    var endpoints: [String] = []
    var selectedEndpoint: String?
    var device: DeviceStatusPayload?
    var pairing: PairingPayload?
    var pairingError: String?
    var error: String?
    var isWorking = false
    var isDiscovering = false
    var isCreatingPairing = false
    var route: PairingRoute = .direct
    var relay: RelayStatusPayload?
    var hasChosenConnection = false

    /// Skip a redundant confirmation, but never a profile choice or a recovery action.
    var canAdvancePastCodex: Bool {
        step == .mac && macState == .ready && !isWorking && !isDiscovering && error == nil
            && profiles.count == 1 && profiles[0].selected && profiles[0].state.isAvailable
    }

    var showsProfilePicker: Bool {
        profiles.count > 1 && [.chooseProfile, .ready].contains(macState)
    }

    var profileToConnect: AppServerPayload? {
        guard macState == .chooseProfile, profiles.count == 1,
              profiles[0].state.isAvailable else { return nil }
        return profiles[0]
    }

    var canPerformPrimaryAction: Bool {
        macState.canPerformPrimaryAction || profileToConnect != nil
    }

    func canNavigate(to destination: SetupStep) -> Bool {
        guard !isWorking else { return false }
        switch destination {
        case .mac: return true
        case .relay: return macState == .ready
        case .phone: return macState == .ready && hasChosenConnection
        }
    }

    var relayIsReady: Bool {
        PairingRoute.relay.destination(endpoint: nil, availableEndpoints: [], relay: relay) != nil
    }

    var canPair: Bool {
        macState == .ready && route.destination(endpoint: selectedEndpoint,
                                                availableEndpoints: endpoints, relay: relay) != nil
    }

    func pairingIsUsable(at date: Date) -> Bool {
        guard canPair, !isCreatingPairing, pairingError == nil, let pairing else { return false }
        return Double(pairing.expiresAtUnixMilliseconds) / 1_000 > date.timeIntervalSince1970
    }
}
