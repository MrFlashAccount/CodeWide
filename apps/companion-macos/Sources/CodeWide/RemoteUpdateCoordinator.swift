import CodeWideShared
import Darwin
import Foundation
@preconcurrency import Sparkle

/// Installs a release confirmed on a paired device with Sparkle. The runtime
/// owns the operation and its journal; this object only executes the command
/// it wrote and reports whether Sparkle started or failed the installation.
@MainActor
final class RemoteUpdateCoordinator {
    private let runtime: RuntimeConnection
    private let updaterRoot: URL
    private var pollTask: Task<Void, Never>?
    private var session: RemoteSparkleSession?
    private var handledOperationID: String?

    init(runtime: RuntimeConnection, updaterRoot: URL = RuntimeConstants.updaterDirectory) {
        self.runtime = runtime
        self.updaterRoot = updaterRoot
    }

    func start() {
        guard pollTask == nil else { return }
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                self?.poll()
                try? await Task.sleep(for: .seconds(1))
            }
        }
    }

    private func poll() {
        guard session == nil else { return }
        let commands = RemoteUpdateSpool.commands(updaterRoot: updaterRoot)
        guard let urls = try? FileManager.default.contentsOfDirectory(
            at: commands,
            includingPropertiesForKeys: [.isRegularFileKey]
        ) else { return }
        let installedVersion = Bundle.main.object(
            forInfoDictionaryKey: "CFBundleShortVersionString"
        ) as? String
        for url in urls where url.pathExtension == "json" && !url.lastPathComponent.hasSuffix(".event.json") {
            guard let command = try? JSONDecoder().decode(
                RemoteUpdateCommand.self,
                from: Data(contentsOf: url)
            ), command.operationId != handledOperationID,
               // The relaunched target leaves its command for the runtime to
               // retire once it recognizes itself.
               command.targetVersion != installedVersion else {
                continue
            }
            handledOperationID = command.operationId
            beginSparkle(command)
            break
        }
    }

    private func beginSparkle(_ command: RemoteUpdateCommand) {
        let writer = RemoteUpdateEventWriter(root: updaterRoot, command: command)
        do {
            let session = try RemoteSparkleSession(
                command: command,
                runtime: runtime,
                writer: writer,
                finished: { [weak self] in self?.session = nil }
            )
            self.session = session
            // Tell the runtime at once that the app took the command, before
            // Sparkle reads its feed.
            try? writer.write(.downloading, downloadedBytes: 0)
            session.start()
        } catch {
            try? writer.write(.failed, error: error.localizedDescription)
            session = nil
        }
    }
}

private struct RemoteUpdateEventWriter {
    let root: URL
    let command: RemoteUpdateCommand

    func write(
        _ kind: RemoteUpdateEvent.Kind,
        error: String? = nil,
        downloadedBytes: UInt64? = nil,
        totalBytes: UInt64? = nil
    ) throws {
        let event = RemoteUpdateEvent(
            operationId: command.operationId,
            nonce: command.nonce,
            kind: kind,
            errorMessage: error,
            downloadedBytes: downloadedBytes,
            totalBytes: totalBytes
        )
        let directory = RemoteUpdateSpool.commands(updaterRoot: root)
        let destination = directory.appending(path: "\(command.operationId).event.json")
        let temporary = directory.appending(path: ".\(command.operationId).\(UUID().uuidString).tmp")
        guard FileManager.default.createFile(
            atPath: temporary.path,
            contents: nil,
            attributes: [.posixPermissions: 0o600]
        ) else { throw RemoteUpdateError.eventWriteFailed }
        do {
            let handle = try FileHandle(forWritingTo: temporary)
            try handle.write(contentsOf: JSONEncoder().encode(event))
            try handle.synchronize()
            try handle.close()
            guard rename(temporary.path, destination.path) == 0 else {
                throw RemoteUpdateError.eventWriteFailed
            }
            let descriptor = open(directory.path, O_RDONLY | O_DIRECTORY)
            guard descriptor >= 0 else { throw RemoteUpdateError.eventWriteFailed }
            defer { close(descriptor) }
            guard fsync(descriptor) == 0 else { throw RemoteUpdateError.eventWriteFailed }
        } catch {
            try? FileManager.default.removeItem(at: temporary)
            throw error
        }
    }
}

@MainActor
private final class RemoteSparkleSession: NSObject, SPUUpdaterDelegate {
    private let command: RemoteUpdateCommand
    private let runtime: RuntimeConnection
    private let writer: RemoteUpdateEventWriter
    private let finished: () -> Void
    private let userDriver: RemoteSparkleUserDriver
    private var updater: SPUUpdater!
    private var preparing = false

    init(
        command: RemoteUpdateCommand,
        runtime: RuntimeConnection,
        writer: RemoteUpdateEventWriter,
        finished: @escaping () -> Void
    ) throws {
        self.command = command
        self.runtime = runtime
        self.writer = writer
        self.finished = finished
        userDriver = RemoteSparkleUserDriver(command: command, writer: writer)
        super.init()
        updater = SPUUpdater(
            hostBundle: .main,
            applicationBundle: .main,
            userDriver: userDriver,
            delegate: self
        )
        try updater.start()
    }

    func start() {
        updater.checkForUpdates()
    }

    func feedURLString(for updater: SPUUpdater) -> String? {
        ProcessInfo.processInfo.environment["CODEWIDE_UPDATE_FEED_URL"]
    }

    func updater(
        _ updater: SPUUpdater,
        shouldProceedWithUpdate updateItem: SUAppcastItem,
        updateCheck: SPUUpdateCheck
    ) throws {
        guard RemoteSparkleAdmission.accepts(
            displayVersion: updateItem.displayVersionString,
            build: updateItem.versionString,
            signatureValidated: updateItem.signingValidationStatus == .succeeded,
            command: command
        ) else {
            throw RemoteUpdateError.wrongSignedTarget
        }
    }

    func updater(
        _ updater: SPUUpdater,
        shouldPostponeRelaunchForUpdate item: SUAppcastItem,
        untilInvokingBlock installHandler: @escaping () -> Void
    ) -> Bool {
        prepare(item: item, install: installHandler)
        return true
    }

    func updater(
        _ updater: SPUUpdater,
        willInstallUpdateOnQuit item: SUAppcastItem,
        immediateInstallationBlock immediateInstallHandler: @escaping () -> Void
    ) -> Bool {
        prepare(item: item, install: immediateInstallHandler)
        return true
    }

    func updater(
        _ updater: SPUUpdater,
        didFinishUpdateCycleFor updateCheck: SPUUpdateCheck,
        error: Error?
    ) {
        guard let error else { return }
        try? writer.write(.failed, error: error.localizedDescription)
        runtime.resumeAfterUpdateFailure()
        finished()
    }

    private func prepare(item: SUAppcastItem, install: @escaping () -> Void) {
        guard !preparing,
              RemoteSparkleAdmission.accepts(
                  displayVersion: item.displayVersionString,
                  build: item.versionString,
                  signatureValidated: item.signingValidationStatus == .succeeded,
                  command: command
              ) else {
            try? writer.write(.failed, error: "sparkle_wrong_target")
            return
        }
        preparing = true
        Task {
            do {
                try writer.write(.installing)
                try await runtime.stopForGuardianUpdate()
                install()
            } catch {
                preparing = false
                try? writer.write(.failed, error: error.localizedDescription)
                runtime.resumeAfterUpdateFailure()
                finished()
            }
        }
    }
}

@MainActor
private final class RemoteSparkleUserDriver: NSObject, SPUUserDriver {
    private let command: RemoteUpdateCommand
    private let writer: RemoteUpdateEventWriter

    private var download = RemoteDownloadProgress()

    init(command: RemoteUpdateCommand, writer: RemoteUpdateEventWriter) {
        self.command = command
        self.writer = writer
    }

    /// Reports download progress at most once a second; every report is a
    /// durable file write the runtime reads on the next status request.
    private func publishDownload(force: Bool) {
        guard let report = download.report(now: .now, force: force) else { return }
        try? writer.write(
            .downloading,
            downloadedBytes: report.downloadedBytes,
            totalBytes: report.totalBytes
        )
    }

    func show(
        _ request: SPUUpdatePermissionRequest,
        reply: @escaping (SUUpdatePermissionResponse) -> Void
    ) {
        reply(SUUpdatePermissionResponse(automaticUpdateChecks: false, sendSystemProfile: false))
    }

    func showUserInitiatedUpdateCheck(cancellation: @escaping () -> Void) {}

    func showUpdateFound(
        with appcastItem: SUAppcastItem,
        state: SPUUserUpdateState,
        reply: @escaping (SPUUserUpdateChoice) -> Void
    ) {
        guard !appcastItem.isInformationOnlyUpdate,
              RemoteSparkleAdmission.accepts(
                  displayVersion: appcastItem.displayVersionString,
                  build: appcastItem.versionString,
                  signatureValidated: appcastItem.signingValidationStatus == .succeeded,
                  command: command
              ) else {
            try? writer.write(.failed, error: "sparkle_wrong_signed_target")
            reply(.dismiss)
            return
        }
        reply(.install)
    }

    func showUpdateReleaseNotes(with downloadData: SPUDownloadData) {}
    func showUpdateReleaseNotesFailedToDownloadWithError(_ error: Error) {}
    func showUpdateNotFoundWithError(_ error: Error, acknowledgement: @escaping () -> Void) {
        try? writer.write(.failed, error: "sparkle_target_not_found")
        acknowledgement()
    }
    func showUpdaterError(_ error: Error, acknowledgement: @escaping () -> Void) {
        try? writer.write(.failed, error: error.localizedDescription)
        acknowledgement()
    }
    func showDownloadInitiated(cancellation: @escaping () -> Void) {
        download = RemoteDownloadProgress()
        publishDownload(force: true)
    }
    func showDownloadDidReceiveExpectedContentLength(_ expectedContentLength: UInt64) {
        download.expect(expectedContentLength)
        publishDownload(force: true)
    }
    func showDownloadDidReceiveData(ofLength length: UInt64) {
        download.receive(length)
        publishDownload(force: false)
    }
    func showDownloadDidStartExtractingUpdate() {
        try? writer.write(.extracting)
    }
    func showExtractionReceivedProgress(_ progress: Double) {}
    func showReady(toInstallAndRelaunch reply: @escaping (SPUUserUpdateChoice) -> Void) {
        reply(.install)
    }
    func showInstallingUpdate(
        withApplicationTerminated applicationTerminated: Bool,
        retryTerminatingApplication: @escaping () -> Void
    ) {}
    func showUpdateInstalledAndRelaunched(
        _ relaunched: Bool,
        acknowledgement: @escaping () -> Void
    ) { acknowledgement() }
    func dismissUpdateInstallation() {}
}

/// Accumulates Sparkle's download callbacks into throttled progress reports.
struct RemoteDownloadProgress {
    struct Report: Equatable {
        let downloadedBytes: UInt64
        let totalBytes: UInt64?
    }

    static let interval: Duration = .seconds(1)

    private(set) var downloadedBytes: UInt64 = 0
    private(set) var totalBytes: UInt64?
    private var lastReport: ContinuousClock.Instant?

    mutating func expect(_ length: UInt64) {
        totalBytes = length > 0 ? length : nil
    }

    mutating func receive(_ length: UInt64) {
        downloadedBytes += length
    }

    /// The report to publish now: forced, the first one, the completed
    /// download, or one at least ``interval`` after the previous report.
    mutating func report(now: ContinuousClock.Instant, force: Bool) -> Report? {
        let complete = totalBytes.map { downloadedBytes >= $0 } ?? false
        if !force, !complete, let lastReport, now - lastReport < Self.interval {
            return nil
        }
        lastReport = now
        return Report(downloadedBytes: downloadedBytes, totalBytes: totalBytes)
    }
}

/// Sparkle may install only the exact release the device confirmed, and only
/// when Sparkle verified its signature.
enum RemoteSparkleAdmission {
    static func accepts(
        displayVersion: String,
        build: String,
        signatureValidated: Bool,
        command: RemoteUpdateCommand
    ) -> Bool {
        signatureValidated
            && displayVersion == command.targetVersion
            && build == command.targetBuild
    }
}

private enum RemoteUpdateError: LocalizedError {
    case eventWriteFailed
    case wrongSignedTarget

    var errorDescription: String? {
        switch self {
        case .eventWriteFailed: "Cannot report remote update progress to the runtime."
        case .wrongSignedTarget: "Sparkle selected a release different from the confirmed target."
        }
    }
}
