import Combine
import Foundation
@preconcurrency import Sparkle

@MainActor
final class UpdateController: NSObject, ObservableObject, SPUUpdaterDelegate {
    @Published private(set) var canCheckForUpdates = false
    @Published private(set) var availableVersion: String?
    @Published private(set) var lastError: String?

    private let runtime: RuntimeConnection
    private let testFeedURL: String?
    private var updaterController: SPUStandardUpdaterController?
    private var preparingUpdate = false
    private var preparedVersion: String?
    private var deferredInstall: (() -> Void)?

    init(runtime: RuntimeConnection) {
        self.runtime = runtime
        testFeedURL = ProcessInfo.processInfo.environment["CODEWIDE_UPDATE_FEED_URL"]
        super.init()
        let controller = SPUStandardUpdaterController(
            startingUpdater: true,
            updaterDelegate: self,
            userDriverDelegate: nil
        )
        updaterController = controller
        controller.updater.publisher(for: \.canCheckForUpdates)
            .assign(to: &$canCheckForUpdates)
        if ProcessInfo.processInfo.environment["CODEWIDE_UPDATE_E2E"] == "1" {
            DispatchQueue.main.async {
                controller.updater.checkForUpdatesInBackground()
            }
        }
    }

    func checkForUpdates() {
        updaterController?.checkForUpdates(nil)
    }

    func updater(_ updater: SPUUpdater, didFindValidUpdate item: SUAppcastItem) {
        availableVersion = item.displayVersionString
    }

    func updaterDidNotFindUpdate(_ updater: SPUUpdater) {
        availableVersion = nil
    }

    func updater(
        _ updater: SPUUpdater,
        didFinishUpdateCycleFor updateCheck: SPUUpdateCheck,
        error: Error?
    ) {
        guard let error else {
            return
        }
        preparingUpdate = false
        preparedVersion = nil
        deferredInstall = nil
        lastError = error.localizedDescription
        runtime.resumeAfterUpdateFailure()
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
