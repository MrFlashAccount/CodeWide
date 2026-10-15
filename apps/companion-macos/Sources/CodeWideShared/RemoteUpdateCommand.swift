import Foundation

/// File contract between the runtime, which accepts a remote update from a
/// paired device, and the menu-bar app, which installs it with Sparkle.
public enum RemoteUpdateSpool {
    /// Commands the runtime wrote and events the app reports for them.
    public static func commands(updaterRoot: URL = RuntimeConstants.updaterDirectory) -> URL {
        updaterRoot.appending(path: "v2/commands", directoryHint: .isDirectory)
    }
}

/// One confirmed release the app must install with Sparkle.
public struct RemoteUpdateCommand: Codable, Equatable, Sendable {
    public let operationId: String
    public let nonce: String
    public let targetVersion: String
    public let targetBuild: String

    public init(operationId: String, nonce: String, targetVersion: String, targetBuild: String) {
        self.operationId = operationId
        self.nonce = nonce
        self.targetVersion = targetVersion
        self.targetBuild = targetBuild
    }
}

/// What the app reports back for a command before the runtime restarts.
public struct RemoteUpdateEvent: Codable, Equatable, Sendable {
    public enum Kind: String, Codable, Sendable {
        /// Sparkle is downloading the confirmed release.
        case downloading
        /// Sparkle is extracting and validating the downloaded archive.
        case extracting
        /// Sparkle verified the release and is about to replace the bundle.
        case installing
        /// Sparkle could not install the release; the installed version stays.
        case failed
    }

    public let operationId: String
    public let nonce: String
    public let kind: Kind
    public let errorMessage: String?
    /// Bytes received so far; reported only while downloading.
    public let downloadedBytes: UInt64?
    /// Expected archive size, when the feed announced it.
    public let totalBytes: UInt64?

    public init(
        operationId: String,
        nonce: String,
        kind: Kind,
        errorMessage: String? = nil,
        downloadedBytes: UInt64? = nil,
        totalBytes: UInt64? = nil
    ) {
        self.operationId = operationId
        self.nonce = nonce
        self.kind = kind
        self.errorMessage = errorMessage
        self.downloadedBytes = downloadedBytes
        self.totalBytes = totalBytes
    }
}
