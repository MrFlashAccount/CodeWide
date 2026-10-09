import CodeWideShared
import Darwin
import Foundation
@preconcurrency import Sparkle

/// Bridges a durable phone-confirmed operation into Sparkle. Sparkle remains
/// the sole forward installer; this object never moves application bundles.
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
                await self?.poll()
                try? await Task.sleep(for: .seconds(1))
            }
        }
    }

    private func poll() async {
        guard session == nil else { return }
        let commands = HostUpdateIPC.commands(updaterRoot: updaterRoot)
        guard let urls = try? FileManager.default.contentsOfDirectory(
            at: commands,
            includingPropertiesForKeys: [.isRegularFileKey]
        ) else { return }
        for url in urls where url.pathExtension == "json" && !url.lastPathComponent.hasSuffix(".event.json") {
            guard let command = try? JSONDecoder().decode(
                GuardianAppCommand.self,
                from: Data(contentsOf: url)
            ), command.operationId != handledOperationID,
               command.canonicalAppPath == Bundle.main.bundleURL.resolvingSymlinksInPath().path else {
                continue
            }
            handledOperationID = command.operationId
            let currentVersion = Bundle.main.object(
                forInfoDictionaryKey: "CFBundleShortVersionString"
            ) as? String
            if currentVersion == command.target.version {
                await reportTargetReady(command)
            } else {
                beginSparkle(command)
            }
            break
        }
    }

    private func beginSparkle(_ command: GuardianAppCommand) {
        do {
            let writer = GuardianAppEventWriter(root: updaterRoot, command: command)
            let session = try RemoteSparkleSession(
                command: command,
                runtime: runtime,
                writer: writer,
                finished: { [weak self] in self?.session = nil }
            )
            self.session = session
            session.start()
        } catch {
            try? GuardianAppEventWriter(root: updaterRoot, command: command)
                .write(kind: "failed", error: error.localizedDescription)
            session = nil
        }
    }

    private func reportTargetReady(_ command: GuardianAppCommand) async {
        let deadline = ContinuousClock.now.advanced(by: .seconds(90))
        while ContinuousClock.now < deadline {
            await runtime.refresh()
            let upstreamLive = runtime.appServer.map {
                if case .available = $0.state { return true }
                return false
            } ?? false
            if runtime.health?.phase == "running", upstreamLive, runtime.relay != nil {
                try? GuardianAppEventWriter(root: updaterRoot, command: command)
                    .write(kind: "targetReady")
                return
            }
            try? await Task.sleep(for: .seconds(1))
        }
        try? GuardianAppEventWriter(root: updaterRoot, command: command)
            .write(kind: "failed", error: "target_runtime_timeout")
    }
}

private struct GuardianAppEventWriter {
    let root: URL
    let command: GuardianAppCommand

    func write(kind: String, error: String? = nil) throws {
        let event = GuardianAppEvent(
            operationId: command.operationId,
            nonce: command.nonce,
            kind: kind,
            targetVersion: command.target.version,
            errorMessage: error
        )
        let directory = HostUpdateIPC.commands(updaterRoot: root)
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
    private let command: GuardianAppCommand
    private let runtime: RuntimeConnection
    private let writer: GuardianAppEventWriter
    private let finished: () -> Void
    private let userDriver: RemoteSparkleUserDriver
    private var updater: SPUUpdater!
    private var preparing = false

    init(
        command: GuardianAppCommand,
        runtime: RuntimeConnection,
        writer: GuardianAppEventWriter,
        finished: @escaping () -> Void
    ) throws {
        self.command = command
        self.runtime = runtime
        self.writer = writer
        self.finished = finished
        userDriver = RemoteSparkleUserDriver(target: command.target, writer: writer)
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
            target: command.target
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
        try? writer.write(kind: "failed", error: error.localizedDescription)
        runtime.resumeAfterUpdateFailure()
        finished()
    }

    private func prepare(item: SUAppcastItem, install: @escaping () -> Void) {
        guard !preparing,
              RemoteSparkleAdmission.accepts(
                  displayVersion: item.displayVersionString,
                  build: item.versionString,
                  signatureValidated: item.signingValidationStatus == .succeeded,
                  target: command.target
              ) else {
            try? writer.write(kind: "failed", error: "sparkle_wrong_target")
            return
        }
        preparing = true
        Task {
            do {
                try await runtime.stopForGuardianUpdate()
                try writer.write(kind: "installing")
                install()
            } catch {
                preparing = false
                try? writer.write(kind: "failed", error: error.localizedDescription)
                runtime.resumeAfterUpdateFailure()
                finished()
            }
        }
    }
}

@MainActor
private final class RemoteSparkleUserDriver: NSObject, SPUUserDriver {
    private let target: ReleaseTargetPayload
    private let writer: GuardianAppEventWriter

    init(target: ReleaseTargetPayload, writer: GuardianAppEventWriter) {
        self.target = target
        self.writer = writer
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
                  target: target
              ) else {
            try? writer.write(kind: "failed", error: "sparkle_wrong_signed_target")
            reply(.dismiss)
            return
        }
        reply(.install)
    }

    func showUpdateReleaseNotes(with downloadData: SPUDownloadData) {}
    func showUpdateReleaseNotesFailedToDownloadWithError(_ error: Error) {}
    func showUpdateNotFoundWithError(_ error: Error, acknowledgement: @escaping () -> Void) {
        try? writer.write(kind: "failed", error: "sparkle_target_not_found")
        acknowledgement()
    }
    func showUpdaterError(_ error: Error, acknowledgement: @escaping () -> Void) {
        try? writer.write(kind: "failed", error: error.localizedDescription)
        acknowledgement()
    }
    func showDownloadInitiated(cancellation: @escaping () -> Void) {}
    func showDownloadDidReceiveExpectedContentLength(_ expectedContentLength: UInt64) {}
    func showDownloadDidReceiveData(ofLength length: UInt64) {}
    func showDownloadDidStartExtractingUpdate() {}
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

enum RemoteSparkleAdmission {
    static func accepts(
        displayVersion: String,
        build: String,
        signatureValidated: Bool,
        target: ReleaseTargetPayload
    ) -> Bool {
        signatureValidated
            && displayVersion == target.version
            && build == target.build
    }
}

private enum RemoteUpdateError: LocalizedError {
    case eventWriteFailed
    case wrongSignedTarget

    var errorDescription: String? {
        switch self {
        case .eventWriteFailed: "Cannot report remote update progress to the guardian."
        case .wrongSignedTarget: "Sparkle selected a release different from the confirmed target."
        }
    }
}
