import Foundation

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
