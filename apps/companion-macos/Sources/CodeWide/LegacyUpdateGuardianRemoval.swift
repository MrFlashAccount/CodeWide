import CodeWideShared
import Darwin
import Foundation

/// Removes the external update guardian that earlier releases installed once
/// under `Updater/bootstrap-v1`. Remote updates are now installed by Sparkle,
/// so its launchd agent, binary and state only keep an idle process alive.
/// A guardian still inside a transaction is left alone until a later launch.
@MainActor
struct LegacyUpdateGuardianRemoval {
    let updaterRoot: URL
    let launchAgentsDirectory: URL
    let bootout: (String) -> Void

    init(
        updaterRoot: URL = RuntimeConstants.updaterDirectory,
        launchAgentsDirectory: URL = FileManager.default.homeDirectoryForCurrentUser
            .appending(path: "Library/LaunchAgents", directoryHint: .isDirectory),
        bootout: ((String) -> Void)? = nil
    ) {
        self.updaterRoot = updaterRoot
        self.launchAgentsDirectory = launchAgentsDirectory
        self.bootout = bootout ?? Self.launchctlBootout
    }

    /// Returns whether no legacy guardian state remains.
    @discardableResult
    func run() -> Bool {
        let fileManager = FileManager.default
        let bootstrap = updaterRoot.appending(path: "bootstrap-v1", directoryHint: .isDirectory)
        let state = updaterRoot.appending(path: "v1", directoryHint: .isDirectory)
        let plist = launchAgentsDirectory.appending(
            path: RuntimeConstants.legacyGuardianLaunchAgentPlistName
        )
        let installed = [bootstrap, state, plist].contains { fileManager.fileExists(atPath: $0.path) }
        guard installed else { return true }
        guard !transactionInProgress(state: state) else { return false }
        bootout("gui/\(geteuid())/\(RuntimeConstants.legacyGuardianLaunchAgentLabel)")
        for item in [plist, bootstrap, state] where fileManager.fileExists(atPath: item.path) {
            try? fileManager.removeItem(at: item)
        }
        return [bootstrap, state, plist].allSatisfy { !fileManager.fileExists(atPath: $0.path) }
    }

    /// The legacy guardian's single journal names a phase it still owns.
    private func transactionInProgress(state: URL) -> Bool {
        guard let data = try? Data(contentsOf: state.appending(path: "journal.json")) else {
            return false
        }
        guard let journal = try? JSONDecoder().decode(LegacyJournal.self, from: data) else {
            // An unreadable journal cannot prove the guardian is idle.
            return true
        }
        return !["committed", "rolledBack", "failed"].contains(journal.phase)
    }

    private struct LegacyJournal: Decodable {
        let phase: String
    }

    private static func launchctlBootout(_ service: String) {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/launchctl")
        process.arguments = ["bootout", service]
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        do {
            try process.run()
            process.waitUntilExit()
        } catch {
            // A missing agent is already the desired state.
        }
    }
}
