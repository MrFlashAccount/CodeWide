import Combine
import Foundation
@preconcurrency import Sparkle

@MainActor
final class UpdateController: NSObject, ObservableObject, SPUUpdaterDelegate {
    @Published private(set) var canCheckForUpdates = false
    @Published private(set) var availableVersion: String?
    @Published private(set) var isCheckingForUpdates = false
    @Published private(set) var lastError: String?

    private let runtime: RuntimeConnection
    private let testFeedURL: String?
    private var updaterController: SPUStandardUpdaterController?
    private var checkAdmission: UpdateCheckAdmission
    private var preparingUpdate = false
    private var preparedVersion: String?
    private var deferredInstall: (() -> Void)?

    init(runtime: RuntimeConnection, startingUpdater: Bool = true) {
        self.runtime = runtime
        testFeedURL = ProcessInfo.processInfo.environment["CODEWIDE_UPDATE_FEED_URL"]
        checkAdmission = UpdateCheckAdmission(
            mode: ProcessInfo.processInfo.environment["CODEWIDE_UPDATE_E2E"] == "1"
                ? .installationTest : .interactive
        )
        super.init()
        let controller = SPUStandardUpdaterController(
            startingUpdater: false,
            updaterDelegate: self,
            userDriverDelegate: nil
        )
        updaterController = controller
        controller.updater.publisher(for: \.canCheckForUpdates)
            .assign(to: &$canCheckForUpdates)
        if startingUpdater {
            controller.startUpdater()
            if checkAdmission.mode == .installationTest {
                // Sparkle permits an immediate check before its next runloop cycle.
                // Dispatching later lets the scheduler or a menu probe claim the session.
                controller.updater.checkForUpdatesInBackground()
            }
        }
    }

    func checkForUpdates() {
        lastError = nil
        updaterController?.checkForUpdates(nil)
    }

    func checkForUpdatesSilentlyIfNeeded(now: Date = Date()) {
        guard let updater = updaterController?.updater,
              checkAdmission.admitInformationProbe(
                  now: now,
                  canCheckForUpdates: canCheckForUpdates,
                  sessionInProgress: updater.sessionInProgress
              ) else {
            return
        }

        lastError = nil
        isCheckingForUpdates = true
        updater.checkForUpdateInformation()
    }

    func updater(_ updater: SPUUpdater, didFindValidUpdate item: SUAppcastItem) {
        lastError = nil
        availableVersion = item.displayVersionString
    }

    func updaterDidNotFindUpdate(_ updater: SPUUpdater) {
        lastError = nil
        availableVersion = nil
    }

    func updater(
        _ updater: SPUUpdater,
        didFinishUpdateCycleFor updateCheck: SPUUpdateCheck,
        error: Error?
    ) {
        isCheckingForUpdates = false
        lastError = nil
        guard let error else {
            return
        }
        let runtimeWasPaused = preparingUpdate || preparedVersion != nil
        preparingUpdate = false
        preparedVersion = nil
        deferredInstall = nil
        if runtimeWasPaused {
            runtime.resumeAfterUpdateFailure()
        }

        // Sparkle reports normal outcomes through NSError too. Classify by
        // domain and code, never by its localized (and sometimes upbeat) text.
        let sparkleError = error as NSError
        if sparkleError.domain == SUSparkleErrorDomain,
           [SUError.noUpdateError, .installationCanceledError, .installationAuthorizeLaterError]
            .contains(where: { Int($0.rawValue) == sparkleError.code }) {
            return
        }
        lastError = error.localizedDescription
    }

    func feedURLString(for updater: SPUUpdater) -> String? {
        testFeedURL
    }

    func updater(
        _ updater: SPUUpdater,
        shouldPostponeRelaunchForUpdate item: SUAppcastItem,
        untilInvokingBlock installHandler: @escaping () -> Void
    ) -> Bool {
        checkpointRuntime(for: item.displayVersionString, then: installHandler)
        return true
    }

    func updater(
        _ updater: SPUUpdater,
        willInstallUpdateOnQuit item: SUAppcastItem,
        immediateInstallationBlock immediateInstallHandler: @escaping () -> Void
    ) -> Bool {
        checkpointRuntime(for: item.displayVersionString, then: immediateInstallHandler)
        return true
    }

    private func checkpointRuntime(
        for targetVersion: String,
        then install: @escaping () -> Void
    ) {
        if preparedVersion == targetVersion {
            install()
            return
        }
        guard !preparingUpdate else {
            deferredInstall = install
            return
        }
        preparingUpdate = true
        Task {
            do {
                try await runtime.prepareForUpdate(targetVersion: targetVersion)
                preparingUpdate = false
                preparedVersion = targetVersion
                let readyInstall = deferredInstall ?? install
                deferredInstall = nil
                readyInstall()
            } catch {
                preparingUpdate = false
                deferredInstall = nil
                lastError = error.localizedDescription
            }
        }
    }
}
