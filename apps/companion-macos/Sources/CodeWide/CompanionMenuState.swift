import CodeWideShared
import Foundation

enum CompanionMenuConnection: Equatable {
    case starting
    case needsPermission
    case helperUnavailable
    case codexUnavailable
    case networkUnavailable
    case connected

    init(
        health: RuntimeHealthPayload?,
        server: AppServerPayload?,
        directAccess: DirectAccessPayload?,
        relay: RelayStatusPayload? = nil,
        requiresApproval: Bool,
        runtimeStatus: String
    ) {
        if requiresApproval {
            self = .needsPermission
        } else if health == nil {
            self = runtimeStatus == "Starting" ? .starting : .helperUnavailable
        } else if health?.phase != "running" {
            self = .helperUnavailable
        } else if server?.state.isAvailable != true {
            self = .codexUnavailable
        } else if directAccess?.endpoints.isEmpty != false && CompanionRelayStatus(relay) != .connected {
            self = .networkUnavailable
        } else {
            self = .connected
        }
    }

    var summary: String {
        switch self {
        case .starting: "Connecting"
        case .needsPermission: "Background access needed"
        case .helperUnavailable: "Companion unavailable"
        case .codexUnavailable: "Not connected"
        case .networkUnavailable: "No network address"
        case .connected: "Connected"
        }
    }

    var title: String {
        switch self {
        case .starting, .connected: "Connect your phone"
        case .needsPermission: "Allow background access"
        case .helperUnavailable: "Reconnect this Mac"
        case .codexUnavailable: "Connect Codex first"
        case .networkUnavailable: "Connect this Mac to a network"
        }
    }

    var explanation: String {
        switch self {
        case .starting, .connected:
            "Open CodeWide on your phone and scan a QR code to connect to this Mac."
        case .needsPermission:
            "Allow CodeWide in Login Items so your Mac can stay available in the background."
        case .helperUnavailable:
            "The background service isn't responding. Try reconnecting, or open Setup from the menu."
        case .codexUnavailable:
            "Choose a running Codex App Server in Setup before connecting your phone."
        case .networkUnavailable:
            "Join Wi-Fi, Ethernet, or a VPN your phone can reach, then try again."
        }
    }

    var actionTitle: String {
        switch self {
        case .starting, .connected: "Show QR Code"
        case .needsPermission: "Open Login Items"
        case .helperUnavailable, .networkUnavailable: "Try Again"
        case .codexUnavailable: "Open Setup"
        }
    }

    var actionSymbol: String {
        switch self {
        case .starting, .connected: "qrcode"
        case .needsPermission: "gearshape"
        case .helperUnavailable, .networkUnavailable: "arrow.clockwise"
        case .codexUnavailable: "slider.horizontal.3"
        }
    }
}

enum CompanionDirectStatus: Equatable, Sendable {
    case available
    case unavailable

    init(_ directAccess: DirectAccessPayload?) {
        self = directAccess?.endpoints.isEmpty == false ? .available : .unavailable
    }

    var summary: String {
        switch self {
        case .available: "Available"
        case .unavailable: "Unavailable"
        }
    }
}

enum CompanionRelayStatus: Equatable, Sendable {
    case notConfigured
    case disabled
    case connecting
    case connected
    case unavailable

    init(_ relay: RelayStatusPayload?) {
        guard let relay, relay.configured else {
            self = .notConfigured
            return
        }
        guard relay.enabled else {
            self = .disabled
            return
        }
        switch relay.connection {
        case "online": self = .connected
        case "connecting", "reconnecting": self = .connecting
        default: self = .unavailable
        }
    }

    var summary: String {
        switch self {
        case .notConfigured: "Not Set Up"
        case .disabled: "Off"
        case .connecting: "Connecting"
        case .connected: "Connected"
        case .unavailable: "Unavailable"
        }
    }
}

extension AppServerState {
    var isAvailable: Bool {
        if case .available = self { return true }
        return false
    }

    var version: String? {
        switch self {
        case let .available(version): version
        case let .unavailable(version): version
        }
    }
}

struct CompanionMenuSnapshot {
    var connection: CompanionMenuConnection = .starting
    var directStatus: CompanionDirectStatus = .unavailable
    var relayStatus: CompanionRelayStatus = .notConfigured
    var devices: [DeviceStatusPayload] = []
    var profileName = "Default"
    var serverVersion: String?
    var appVersion: String?
    var coreVersion: String?
    var address: String?
    var availableUpdate: String?
    var noticeTitle = "Something needs attention"
    var notice: String?
    var isWorking = false
    var canManageDevices = false

    var onlineDeviceCount: Int {
        devices.filter { $0.activeConnections > 0 }.count
    }

    var devicesSummary: String {
        if connection != .connected { return "Status unavailable" }
        return "\(onlineDeviceCount) of \(devices.count) connected"
    }
}
