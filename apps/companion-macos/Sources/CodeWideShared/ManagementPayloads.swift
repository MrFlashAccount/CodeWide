import Foundation

public enum AppServerState: Equatable, Sendable {
    case available(version: String?)
    case unavailable(lastKnownVersion: String?)
}

public enum CodexInstallationState: Equatable, Sendable {
    case notFound(minimumVersion: String)
    case unverified(minimumVersion: String)
    case updateRequired(installedVersion: String, minimumVersion: String)
    case ready(installedVersion: String)
}

public final class CodexInstallationPayload: NSObject, NSSecureCoding, @unchecked Sendable {
    public static let supportsSecureCoding = true

    public let state: CodexInstallationState

    public init(state: CodexInstallationState) {
        self.state = state
    }

    public required init?(coder: NSCoder) {
        let installedVersion = coder.decodeObject(
            of: NSString.self,
            forKey: "installedVersion"
        ) as String?
        let minimumVersion = coder.decodeObject(
            of: NSString.self,
            forKey: "minimumVersion"
        ) as String?
        switch coder.decodeInteger(forKey: "state") {
        case 1:
            guard let minimumVersion else { return nil }
            state = .notFound(minimumVersion: minimumVersion)
        case 2:
            guard let minimumVersion else { return nil }
            state = .unverified(minimumVersion: minimumVersion)
        case 3:
            guard let installedVersion, let minimumVersion else { return nil }
            state = .updateRequired(
                installedVersion: installedVersion,
                minimumVersion: minimumVersion
            )
        case 4:
            guard let installedVersion else { return nil }
            state = .ready(installedVersion: installedVersion)
        default:
            return nil
        }
    }

    public func encode(with coder: NSCoder) {
        switch state {
        case let .notFound(minimumVersion):
            coder.encode(1, forKey: "state")
            coder.encode(minimumVersion, forKey: "minimumVersion")
        case let .unverified(minimumVersion):
            coder.encode(2, forKey: "state")
            coder.encode(minimumVersion, forKey: "minimumVersion")
        case let .updateRequired(installedVersion, minimumVersion):
            coder.encode(3, forKey: "state")
            coder.encode(installedVersion, forKey: "installedVersion")
            coder.encode(minimumVersion, forKey: "minimumVersion")
        case let .ready(installedVersion):
            coder.encode(4, forKey: "state")
            coder.encode(installedVersion, forKey: "installedVersion")
        }
    }
}

public final class AppServerPayload: NSObject, NSSecureCoding, @unchecked Sendable {
    public static let supportsSecureCoding = true

    public let id: String
    public let displayName: String
    public let codexHome: String
    public let state: AppServerState
    public let selected: Bool

    public init(
        id: String,
        displayName: String,
        codexHome: String,
        state: AppServerState,
        selected: Bool
    ) {
        self.id = id
        self.displayName = displayName
        self.codexHome = codexHome
        self.state = state
        self.selected = selected
    }

    public required init?(coder: NSCoder) {
        guard
            let id = coder.decodeObject(of: NSString.self, forKey: "id") as String?,
            let displayName = coder.decodeObject(
                of: NSString.self,
                forKey: "displayName"
            ) as String?,
            let codexHome = coder.decodeObject(of: NSString.self, forKey: "codexHome") as String?
        else {
            return nil
        }
        let version = coder.decodeObject(of: NSString.self, forKey: "version") as String?
        switch coder.decodeInteger(forKey: "state") {
        case 1:
            state = .available(version: version)
        case 2:
            state = .unavailable(lastKnownVersion: version)
        default:
            return nil
        }
        self.id = id
        self.displayName = displayName
        self.codexHome = codexHome
        selected = coder.decodeBool(forKey: "selected")
    }

    public func encode(with coder: NSCoder) {
        coder.encode(id, forKey: "id")
        coder.encode(displayName, forKey: "displayName")
        coder.encode(codexHome, forKey: "codexHome")
        coder.encode(selected, forKey: "selected")
        switch state {
        case let .available(version):
            coder.encode(1, forKey: "state")
            coder.encode(version, forKey: "version")
        case let .unavailable(lastKnownVersion):
            coder.encode(2, forKey: "state")
            coder.encode(lastKnownVersion, forKey: "version")
        }
    }
}

public final class AppServerListPayload: NSObject, NSSecureCoding, @unchecked Sendable {
    public static let supportsSecureCoding = true

    public let servers: [AppServerPayload]
    public let codexInstallation: CodexInstallationPayload

    public init(
        servers: [AppServerPayload],
        codexInstallation: CodexInstallationPayload
    ) {
        self.servers = servers
        self.codexInstallation = codexInstallation
    }

    public required init?(coder: NSCoder) {
        guard
            let servers = coder.decodeObject(
                of: [NSArray.self, AppServerPayload.self],
                forKey: "servers"
            ) as? [AppServerPayload],
            let codexInstallation = coder.decodeObject(
                of: CodexInstallationPayload.self,
                forKey: "codexInstallation"
            )
        else {
            return nil
        }
        self.servers = servers
        self.codexInstallation = codexInstallation
    }

    public func encode(with coder: NSCoder) {
        coder.encode(servers, forKey: "servers")
        coder.encode(codexInstallation, forKey: "codexInstallation")
    }
}

public final class RelayStatusPayload: NSObject, NSSecureCoding, @unchecked Sendable {
    public static let supportsSecureCoding = true

    public let configured: Bool
    public let enabled: Bool
    public let connection: String
    public let publicEndpoint: String?

    public init(
        configured: Bool,
        enabled: Bool,
        connection: String,
        publicEndpoint: String?
    ) {
        self.configured = configured
        self.enabled = enabled
        self.connection = connection
        self.publicEndpoint = publicEndpoint
    }

    public required init?(coder: NSCoder) {
        guard let connection = coder.decodeObject(
            of: NSString.self,
            forKey: "connection"
        ) as String? else {
            return nil
        }
        configured = coder.decodeBool(forKey: "configured")
        enabled = coder.decodeBool(forKey: "enabled")
        self.connection = connection
        publicEndpoint = coder.decodeObject(
            of: NSString.self,
            forKey: "publicEndpoint"
        ) as String?
    }

    public func encode(with coder: NSCoder) {
        coder.encode(configured, forKey: "configured")
        coder.encode(enabled, forKey: "enabled")
        coder.encode(connection, forKey: "connection")
        coder.encode(publicEndpoint, forKey: "publicEndpoint")
    }
}

public final class DeviceStatusPayload: NSObject, NSSecureCoding, @unchecked Sendable {
    public static let supportsSecureCoding = true

    public let id: String
    public let name: String
    public let createdAtUnixMilliseconds: UInt64
    public let lastSeenAtUnixMilliseconds: UInt64
    public let activeConnections: UInt32

    public init(
        id: String,
        name: String,
        createdAtUnixMilliseconds: UInt64,
        lastSeenAtUnixMilliseconds: UInt64,
        activeConnections: UInt32
    ) {
        self.id = id
        self.name = name
        self.createdAtUnixMilliseconds = createdAtUnixMilliseconds
        self.lastSeenAtUnixMilliseconds = lastSeenAtUnixMilliseconds
        self.activeConnections = activeConnections
    }

    public required init?(coder: NSCoder) {
        guard
            let id = coder.decodeObject(of: NSString.self, forKey: "id") as String?,
            let name = coder.decodeObject(of: NSString.self, forKey: "name") as String?
        else {
            return nil
        }
        let created = coder.decodeInt64(forKey: "createdAtUnixMilliseconds")
        let lastSeen = coder.decodeInt64(forKey: "lastSeenAtUnixMilliseconds")
        let active = coder.decodeInt64(forKey: "activeConnections")
        guard created >= 0, lastSeen >= 0, active >= 0, active <= Int64(UInt32.max) else {
            return nil
        }
        self.id = id
        self.name = name
        createdAtUnixMilliseconds = UInt64(created)
        lastSeenAtUnixMilliseconds = UInt64(lastSeen)
        activeConnections = UInt32(active)
    }

    public func encode(with coder: NSCoder) {
        coder.encode(id, forKey: "id")
        coder.encode(name, forKey: "name")
        coder.encode(Int64(clamping: createdAtUnixMilliseconds), forKey: "createdAtUnixMilliseconds")
        coder.encode(Int64(clamping: lastSeenAtUnixMilliseconds), forKey: "lastSeenAtUnixMilliseconds")
        coder.encode(Int64(activeConnections), forKey: "activeConnections")
    }
}

public final class DeviceListPayload: NSObject, NSSecureCoding, @unchecked Sendable {
    public static let supportsSecureCoding = true

    public let devices: [DeviceStatusPayload]

    public init(devices: [DeviceStatusPayload]) {
        self.devices = devices
    }

    public required init?(coder: NSCoder) {
        guard let devices = coder.decodeObject(
            of: [NSArray.self, DeviceStatusPayload.self],
            forKey: "devices"
        ) as? [DeviceStatusPayload] else {
            return nil
        }
        self.devices = devices
    }

    public func encode(with coder: NSCoder) {
        coder.encode(devices, forKey: "devices")
    }
}

public final class PairingPayload: NSObject, NSSecureCoding, @unchecked Sendable {
    public static let supportsSecureCoding = true

    public let link: String
    public let expiresAtUnixMilliseconds: UInt64

    public init(link: String, expiresAtUnixMilliseconds: UInt64) {
        self.link = link
        self.expiresAtUnixMilliseconds = expiresAtUnixMilliseconds
    }

    public required init?(coder: NSCoder) {
        guard let link = coder.decodeObject(of: NSString.self, forKey: "link") as String? else {
            return nil
        }
        let expiresAt = coder.decodeInt64(forKey: "expiresAtUnixMilliseconds")
        guard expiresAt >= 0 else {
            return nil
        }
        self.link = link
        expiresAtUnixMilliseconds = UInt64(expiresAt)
    }

    public func encode(with coder: NSCoder) {
        coder.encode(link, forKey: "link")
        coder.encode(Int64(clamping: expiresAtUnixMilliseconds), forKey: "expiresAtUnixMilliseconds")
    }
}
