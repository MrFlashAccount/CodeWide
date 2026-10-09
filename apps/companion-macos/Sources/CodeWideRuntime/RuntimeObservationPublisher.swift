import CodeWideShared
import CompanionSwiftFFI
import Darwin
import Foundation
import OSLog

/// Publishes a fresh, non-authoritative readiness observation for the external
/// guardian. The guardian remains the only operation/journal authority.
final class RuntimeObservationPublisher: @unchecked Sendable {
    private let core: CoreHost
    private let destination: URL
    private let logger = Logger(
        subsystem: RuntimeConstants.appBundleIdentifier,
        category: "UpdateObservation"
    )
    private var timer: DispatchSourceTimer?

    init(core: CoreHost, updaterRoot: URL = RuntimeConstants.updaterDirectory) {
        self.core = core
        destination = updaterRoot.appending(path: "v1/runtime-observation.json")
    }

    func start() {
        let timer = DispatchSource.makeTimerSource(queue: .global(qos: .utility))
        timer.schedule(deadline: .now(), repeating: .seconds(1), leeway: .milliseconds(100))
        timer.setEventHandler { [weak self] in self?.publish() }
        self.timer = timer
        timer.resume()
    }

    private func publish() {
        do {
            let health = try core.health()
            let relay = try core.relayStatus()
            let upstreamLive: Bool = switch core.appServerConnection() {
            case .live: true
            case .reconnecting: false
            }
            let observation = GuardianRuntimeObservation(
                observedAt: UInt64(Date().timeIntervalSince1970 * 1_000),
                processID: ProcessInfo.processInfo.processIdentifier,
                appVersion: health.appVersion,
                coreRunning: health.phase == "running",
                upstreamLive: upstreamLive,
                relayConfigured: relay.configured,
                relayEnabled: relay.enabled,
                relayLive: relay.connection == "online"
            )
            try write(observation)
        } catch {
            logger.error("Cannot publish guardian observation: \(error.localizedDescription, privacy: .private)")
        }
    }

    private func write(_ observation: GuardianRuntimeObservation) throws {
        let parent = destination.deletingLastPathComponent()
        try FileManager.default.createDirectory(
            at: parent,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: parent.path)
        let values = try parent.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
        guard values.isDirectory == true, values.isSymbolicLink != true else {
            throw ObservationError.unsafeDirectory
        }
        let temporary = parent.appending(path: ".runtime-observation.\(UUID().uuidString).tmp")
        guard FileManager.default.createFile(
            atPath: temporary.path,
            contents: nil,
            attributes: [.posixPermissions: 0o600]
        ) else { throw ObservationError.createFailed }
        do {
            let handle = try FileHandle(forWritingTo: temporary)
            try handle.write(contentsOf: JSONEncoder().encode(observation))
            try handle.synchronize()
            try handle.close()
            guard rename(temporary.path, destination.path) == 0 else {
                throw ObservationError.atomicRenameFailed
            }
            let descriptor = open(parent.path, O_RDONLY | O_DIRECTORY)
            guard descriptor >= 0 else { throw ObservationError.syncFailed }
            defer { close(descriptor) }
            guard fsync(descriptor) == 0 else { throw ObservationError.syncFailed }
        } catch {
            try? FileManager.default.removeItem(at: temporary)
            throw error
        }
    }
}

private enum ObservationError: Error {
    case createFailed
    case unsafeDirectory
    case atomicRenameFailed
    case syncFailed
}
