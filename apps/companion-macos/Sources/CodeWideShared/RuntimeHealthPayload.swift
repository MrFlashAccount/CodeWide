import Foundation

public final class RuntimeHealthPayload: NSObject, NSSecureCoding, @unchecked Sendable {
    public static let supportsSecureCoding = true

    public let phase: String
    public let degradedReason: String?
    public let appVersion: String
    public let hostVersion: String
    public let coreVersion: String
    public let stateSchema: UInt32
    public let processID: Int32
    public let launchCount: UInt64
    public let startedAtUnixMilliseconds: UInt64
    public let updateStatus: String
    public let updateFromVersion: String?
    public let updateTargetVersion: String?
    public let updateFailureReason: String?
    public let hostExecutablePath: String

    public init(
        phase: String,
        degradedReason: String?,
        appVersion: String,
        hostVersion: String,
        coreVersion: String,
        stateSchema: UInt32,
        processID: Int32,
        launchCount: UInt64,
        startedAtUnixMilliseconds: UInt64,
        updateStatus: String,
        updateFromVersion: String?,
        updateTargetVersion: String?,
        updateFailureReason: String?,
        hostExecutablePath: String
    ) {
        self.phase = phase
        self.degradedReason = degradedReason
        self.appVersion = appVersion
        self.hostVersion = hostVersion
        self.coreVersion = coreVersion
        self.stateSchema = stateSchema
        self.processID = processID
        self.launchCount = launchCount
        self.startedAtUnixMilliseconds = startedAtUnixMilliseconds
        self.updateStatus = updateStatus
        self.updateFromVersion = updateFromVersion
        self.updateTargetVersion = updateTargetVersion
        self.updateFailureReason = updateFailureReason
        self.hostExecutablePath = hostExecutablePath
    }

    public required init?(coder: NSCoder) {
        guard
            let phase = coder.decodeObject(of: NSString.self, forKey: "phase") as String?,
            let appVersion = coder.decodeObject(of: NSString.self, forKey: "appVersion") as String?,
            let hostVersion = coder.decodeObject(of: NSString.self, forKey: "hostVersion") as String?,
            let coreVersion = coder.decodeObject(of: NSString.self, forKey: "coreVersion") as String?,
            let updateStatus = coder.decodeObject(of: NSString.self, forKey: "updateStatus") as String?,
            let hostExecutablePath = coder.decodeObject(
                of: NSString.self,
                forKey: "hostExecutablePath"
            ) as String?
        else {
            return nil
        }
        let stateSchema = coder.decodeInt64(forKey: "stateSchema")
        let launchCount = coder.decodeInt64(forKey: "launchCount")
        let startedAt = coder.decodeInt64(forKey: "startedAtUnixMilliseconds")
        guard
            stateSchema >= 0,
            stateSchema <= Int64(UInt32.max),
            launchCount >= 0,
            startedAt >= 0
        else {
            return nil
        }
        self.phase = phase
        degradedReason = coder.decodeObject(of: NSString.self, forKey: "degradedReason") as String?
        self.appVersion = appVersion
        self.hostVersion = hostVersion
        self.coreVersion = coreVersion
        self.stateSchema = UInt32(stateSchema)
        processID = coder.decodeInt32(forKey: "processID")
        self.launchCount = UInt64(launchCount)
        startedAtUnixMilliseconds = UInt64(startedAt)
        self.updateStatus = updateStatus
        updateFromVersion = coder.decodeObject(
            of: NSString.self,
            forKey: "updateFromVersion"
        ) as String?
        updateTargetVersion = coder.decodeObject(
            of: NSString.self,
            forKey: "updateTargetVersion"
        ) as String?
        updateFailureReason = coder.decodeObject(
            of: NSString.self,
            forKey: "updateFailureReason"
        ) as String?
        self.hostExecutablePath = hostExecutablePath
    }

    public func encode(with coder: NSCoder) {
        coder.encode(phase, forKey: "phase")
        coder.encode(degradedReason, forKey: "degradedReason")
        coder.encode(appVersion, forKey: "appVersion")
        coder.encode(hostVersion, forKey: "hostVersion")
        coder.encode(coreVersion, forKey: "coreVersion")
        coder.encode(Int64(stateSchema), forKey: "stateSchema")
        coder.encode(processID, forKey: "processID")
        coder.encode(Int64(clamping: launchCount), forKey: "launchCount")
        coder.encode(
            Int64(clamping: startedAtUnixMilliseconds),
            forKey: "startedAtUnixMilliseconds"
        )
        coder.encode(updateStatus, forKey: "updateStatus")
        coder.encode(updateFromVersion, forKey: "updateFromVersion")
        coder.encode(updateTargetVersion, forKey: "updateTargetVersion")
        coder.encode(updateFailureReason, forKey: "updateFailureReason")
        coder.encode(hostExecutablePath, forKey: "hostExecutablePath")
    }
}
