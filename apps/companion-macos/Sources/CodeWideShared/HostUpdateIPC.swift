import Foundation

/// Additive, file-spool IPC V1 shared by the runtime proxy, menu app, and
/// immutable updater guardian. The guardian is the only journal writer.
public enum HostUpdateIPC {
    public static let version: UInt16 = 1
    public static let apiVersion: UInt16 = 1
    public static let guardianContractVersion: UInt16 = 1
    public static let journalVersion: UInt16 = 1
    public static let bootstrapVersion: UInt16 = 1

    public static func ipcDirectory(updaterRoot: URL = RuntimeConstants.updaterDirectory) -> URL {
        updaterRoot.appending(path: "v1/ipc", directoryHint: .isDirectory)
    }

    public static func inbox(updaterRoot: URL = RuntimeConstants.updaterDirectory) -> URL {
        ipcDirectory(updaterRoot: updaterRoot).appending(path: "inbox", directoryHint: .isDirectory)
    }

    public static func outbox(updaterRoot: URL = RuntimeConstants.updaterDirectory) -> URL {
        ipcDirectory(updaterRoot: updaterRoot).appending(path: "outbox", directoryHint: .isDirectory)
    }

    public static func commands(updaterRoot: URL = RuntimeConstants.updaterDirectory) -> URL {
        updaterRoot.appending(path: "v1/commands", directoryHint: .isDirectory)
    }
}

public struct GuardianIPCRequest: Codable, Sendable {
    public let ipcVersion: UInt16
    public let apiVersion: UInt16
    public let guardianContractVersion: UInt16
    public let journalVersion: UInt16
    public let bootstrapVersion: UInt16
    public let requestId: String
    public let method: String
    public let command: ApplyHostUpdateCommandPayload?
    public let operationId: String?
    public let receipt: ReconnectReceiptPayload?

    public init(
        requestId: String,
        method: String,
        command: ApplyHostUpdateCommandPayload? = nil,
        operationId: String? = nil,
        receipt: ReconnectReceiptPayload? = nil
    ) {
        ipcVersion = HostUpdateIPC.version
        apiVersion = HostUpdateIPC.apiVersion
        guardianContractVersion = HostUpdateIPC.guardianContractVersion
        journalVersion = HostUpdateIPC.journalVersion
        bootstrapVersion = HostUpdateIPC.bootstrapVersion
        self.requestId = requestId
        self.method = method
        self.command = command
        self.operationId = operationId
        self.receipt = receipt
    }

    public var supportsV1: Bool {
        ipcVersion == HostUpdateIPC.version
            && apiVersion == HostUpdateIPC.apiVersion
            && guardianContractVersion == HostUpdateIPC.guardianContractVersion
            && journalVersion == HostUpdateIPC.journalVersion
            && bootstrapVersion == HostUpdateIPC.bootstrapVersion
    }
}

public struct ApplyHostUpdateCommandPayload: Codable, Sendable {
    public let targetFingerprint: String
    public let idempotencyKey: String
    public let initiatingDeviceId: String

    public init(targetFingerprint: String, idempotencyKey: String, initiatingDeviceId: String) {
        self.targetFingerprint = targetFingerprint
        self.idempotencyKey = idempotencyKey
        self.initiatingDeviceId = initiatingDeviceId
    }
}

public struct ReconnectReceiptPayload: Codable, Sendable {
    public let operationId: String
    public let deviceId: String

    public init(operationId: String, deviceId: String) {
        self.operationId = operationId
        self.deviceId = deviceId
    }
}

public struct GuardianIPCError: Codable, Error, Sendable {
    public let code: String
    public let message: String

    public init(code: String, message: String) {
        self.code = code
        self.message = message
    }
}

public struct GuardianIPCResponse<Payload: Codable & Sendable>: Codable, Sendable {
    public let ipcVersion: UInt16
    public let requestId: String
    public let payload: Payload?
    public let error: GuardianIPCError?

    public init(requestId: String, payload: Payload) {
        ipcVersion = HostUpdateIPC.version
        self.requestId = requestId
        self.payload = payload
        error = nil
    }

    public init(requestId: String, error: GuardianIPCError) {
        ipcVersion = HostUpdateIPC.version
        self.requestId = requestId
        payload = nil
        self.error = error
    }
}

public struct EmptyGuardianPayload: Codable, Sendable {
    public init() {}
}

public struct HostUpdateStatusPayload: Codable, Sendable {
    public let platform: String
    public let currentVersion: String
    public let currentBuild: String
    public let currentSourceRevision: String
    public let currentDigest: String
    public let capability: HostUpdateCapabilityPayload
    public let availableTarget: AvailableHostUpdatePayload?
    public let activeOperation: HostUpdateOperationPayload?

    public init(
        currentVersion: String,
        currentBuild: String,
        currentSourceRevision: String,
        currentDigest: String,
        capability: HostUpdateCapabilityPayload,
        availableTarget: AvailableHostUpdatePayload?,
        activeOperation: HostUpdateOperationPayload?
    ) {
        platform = "macos-universal"
        self.currentVersion = currentVersion
        self.currentBuild = currentBuild
        self.currentSourceRevision = currentSourceRevision
        self.currentDigest = currentDigest
        self.capability = capability
        self.availableTarget = availableTarget
        self.activeOperation = activeOperation
    }
}

public struct HostUpdateCapabilityPayload: Codable, Sendable {
    public let apiVersion: UInt16
    public let guardianContractVersion: UInt16
    public let journalVersion: UInt16
    public let bootstrapVersion: UInt16
    public let applySupported: Bool
    public let unavailableReason: String?

    public static func enabled() -> Self {
        Self(
            apiVersion: HostUpdateIPC.apiVersion,
            guardianContractVersion: HostUpdateIPC.guardianContractVersion,
            journalVersion: HostUpdateIPC.journalVersion,
            bootstrapVersion: HostUpdateIPC.bootstrapVersion,
            applySupported: true,
            unavailableReason: nil
        )
    }

    public static func disabled(_ reason: String) -> Self {
        Self(
            apiVersion: HostUpdateIPC.apiVersion,
            guardianContractVersion: 0,
            journalVersion: 0,
            bootstrapVersion: 0,
            applySupported: false,
            unavailableReason: reason
        )
    }
}

public struct AvailableHostUpdatePayload: Codable, Sendable {
    public let target: ReleaseTargetPayload
    public let targetFingerprint: String
    public let releaseSequence: UInt64
    public let expiresAt: UInt64

    public init(target: ReleaseTargetPayload, targetFingerprint: String, releaseSequence: UInt64, expiresAt: UInt64) {
        self.target = target
        self.targetFingerprint = targetFingerprint
        self.releaseSequence = releaseSequence
        self.expiresAt = expiresAt
    }
}

public struct ReleaseTargetPayload: Codable, Sendable {
    public let platform: String
    public let version: String
    public let build: String
    public let sourceRevision: String
    public let artifactUrl: String
    public let sha256: String
    public let bootstrapVersion: UInt16
    public let journalVersion: UInt16
    public let stateEpoch: UInt32
    public let rollbackCompatibleFrom: [String]

    public init(platform: String, version: String, build: String, sourceRevision: String,
                artifactUrl: String, sha256: String, bootstrapVersion: UInt16,
                journalVersion: UInt16, stateEpoch: UInt32, rollbackCompatibleFrom: [String]) {
        self.platform = platform
        self.version = version
        self.build = build
        self.sourceRevision = sourceRevision
        self.artifactUrl = artifactUrl
        self.sha256 = sha256
        self.bootstrapVersion = bootstrapVersion
        self.journalVersion = journalVersion
        self.stateEpoch = stateEpoch
        self.rollbackCompatibleFrom = rollbackCompatibleFrom
    }
}

public struct HostUpdateOperationPayload: Codable, Sendable {
    public let operationId: String
    public let phase: String
    public let currentVersion: String
    public let targetVersion: String
    public let targetFingerprint: String
    public let startedAt: UInt64
    public let updatedAt: UInt64
    public let errorCode: String?
    public let errorMessage: String?

    public init(operationId: String, phase: String, currentVersion: String,
                targetVersion: String, targetFingerprint: String, startedAt: UInt64,
                updatedAt: UInt64, errorCode: String?, errorMessage: String?) {
        self.operationId = operationId
        self.phase = phase
        self.currentVersion = currentVersion
        self.targetVersion = targetVersion
        self.targetFingerprint = targetFingerprint
        self.startedAt = startedAt
        self.updatedAt = updatedAt
        self.errorCode = errorCode
        self.errorMessage = errorMessage
    }
}

public struct ApplyHostUpdateAcceptedPayload: Codable, Sendable {
    public let operationId: String
    public let phase: String

    public init(operationId: String, phase: String) {
        self.operationId = operationId
        self.phase = phase
    }
}

public struct HostUpdateRelayStatePayload: Codable, Sendable {
    public let configured: Bool
    public let enabled: Bool
    public let upstreamLive: Bool

    public init(configured: Bool, enabled: Bool, upstreamLive: Bool) {
        self.configured = configured
        self.enabled = enabled
        self.upstreamLive = upstreamLive
    }
}

public struct HostUpdateDeadlinesPayload: Codable, Sendable {
    public let installBy: UInt64
    public let targetReadyBy: UInt64
    public let reconnectBy: UInt64
    public let rollbackBy: UInt64

    public init(installBy: UInt64, targetReadyBy: UInt64, reconnectBy: UInt64, rollbackBy: UInt64) {
        self.installBy = installBy
        self.targetReadyBy = targetReadyBy
        self.reconnectBy = reconnectBy
        self.rollbackBy = rollbackBy
    }
}

/// Exact durable journal V1. Only the guardian executable may write this shape.
public struct HostUpdateJournalPayload: Codable, Sendable {
    public let journalVersion: UInt16
    public let operationId: String
    public let nonce: String
    public let initiatingDeviceId: String
    public let currentDigest: String
    public let targetDigest: String
    public let targetFingerprint: String
    public let preUpdateRelay: HostUpdateRelayStatePayload
    public let deadlines: HostUpdateDeadlinesPayload
    public var phase: String
    public let startedAt: UInt64
    public var restartStartedAt: UInt64?
    public var updatedAt: UInt64
    public var errorCode: String?
    public var errorMessage: String?

    public init(journalVersion: UInt16, operationId: String, nonce: String,
                initiatingDeviceId: String, currentDigest: String, targetDigest: String,
                targetFingerprint: String, preUpdateRelay: HostUpdateRelayStatePayload,
                deadlines: HostUpdateDeadlinesPayload, phase: String, startedAt: UInt64,
                restartStartedAt: UInt64?, updatedAt: UInt64, errorCode: String?,
                errorMessage: String?) {
        self.journalVersion = journalVersion
        self.operationId = operationId
        self.nonce = nonce
        self.initiatingDeviceId = initiatingDeviceId
        self.currentDigest = currentDigest
        self.targetDigest = targetDigest
        self.targetFingerprint = targetFingerprint
        self.preUpdateRelay = preUpdateRelay
        self.deadlines = deadlines
        self.phase = phase
        self.startedAt = startedAt
        self.restartStartedAt = restartStartedAt
        self.updatedAt = updatedAt
        self.errorCode = errorCode
        self.errorMessage = errorMessage
    }
}

public struct GuardianAppCommand: Codable, Sendable {
    public let operationId: String
    public let nonce: String
    public let target: ReleaseTargetPayload
    public let canonicalAppPath: String

    public init(operationId: String, nonce: String, target: ReleaseTargetPayload,
                canonicalAppPath: String) {
        self.operationId = operationId
        self.nonce = nonce
        self.target = target
        self.canonicalAppPath = canonicalAppPath
    }
}

public struct GuardianAppEvent: Codable, Sendable {
    public let operationId: String
    public let nonce: String
    public let kind: String
    public let targetVersion: String
    public let errorMessage: String?

    public init(
        operationId: String,
        nonce: String,
        kind: String,
        targetVersion: String,
        errorMessage: String? = nil
    ) {
        self.operationId = operationId
        self.nonce = nonce
        self.kind = kind
        self.targetVersion = targetVersion
        self.errorMessage = errorMessage
    }
}

public struct GuardianBootstrapTrust: Codable, Sendable {
    public let schemaVersion: UInt16
    public let keyId: String
    public let publicKeySPKI: String
}

public struct GuardianInstallation: Codable, Sendable {
    public let schemaVersion: UInt16
    public let canonicalAppPath: String
    public let installedAt: UInt64

    public init(schemaVersion: UInt16, canonicalAppPath: String, installedAt: UInt64) {
        self.schemaVersion = schemaVersion
        self.canonicalAppPath = canonicalAppPath
        self.installedAt = installedAt
    }
}

public struct GuardianBootstrapReceipt: Codable, Sendable {
    public let schemaVersion: UInt16
    public let currentVersion: String
    public let currentBuild: String
    public let currentSourceRevision: String
    public let currentDigest: String
    public let highestSequence: UInt64
    public let stateEpoch: UInt32
    public let bundleTreeDigest: String

    public init(schemaVersion: UInt16, currentVersion: String, currentBuild: String,
                currentSourceRevision: String, currentDigest: String, highestSequence: UInt64,
                stateEpoch: UInt32, bundleTreeDigest: String) {
        self.schemaVersion = schemaVersion
        self.currentVersion = currentVersion
        self.currentBuild = currentBuild
        self.currentSourceRevision = currentSourceRevision
        self.currentDigest = currentDigest
        self.highestSequence = highestSequence
        self.stateEpoch = stateEpoch
        self.bundleTreeDigest = bundleTreeDigest
    }
}

public struct GuardianRuntimeObservation: Codable, Sendable {
    public let observedAt: UInt64
    public let processID: Int32
    public let appVersion: String
    public let coreRunning: Bool
    public let upstreamLive: Bool
    public let relayConfigured: Bool
    public let relayEnabled: Bool
    public let relayLive: Bool

    public init(observedAt: UInt64, processID: Int32, appVersion: String, coreRunning: Bool,
                upstreamLive: Bool, relayConfigured: Bool, relayEnabled: Bool, relayLive: Bool) {
        self.observedAt = observedAt
        self.processID = processID
        self.appVersion = appVersion
        self.coreRunning = coreRunning
        self.upstreamLive = upstreamLive
        self.relayConfigured = relayConfigured
        self.relayEnabled = relayEnabled
        self.relayLive = relayLive
    }
}
