import CodeWideShared
import Foundation
import Testing
@testable import CodeWide

@MainActor
@Suite("Legacy update guardian removal")
struct LegacyUpdateGuardianRemovalTests {
    private func fixture(journalPhase: String?) throws -> (URL, URL, URL) {
        let root = FileManager.default.temporaryDirectory
            .appending(path: "cw-legacy-\(UUID().uuidString)", directoryHint: .isDirectory)
        let updater = root.appending(path: "Updater", directoryHint: .isDirectory)
        let agents = root.appending(path: "LaunchAgents", directoryHint: .isDirectory)
        let bootstrap = updater.appending(path: "bootstrap-v1", directoryHint: .isDirectory)
        let state = updater.appending(path: "v1", directoryHint: .isDirectory)
        for directory in [bootstrap, state, agents] {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        }
        try Data("guardian".utf8).write(to: bootstrap.appending(path: "CodeWideUpdateGuardian"))
        try Data("<plist/>".utf8).write(
            to: agents.appending(path: RuntimeConstants.legacyGuardianLaunchAgentPlistName)
        )
        if let journalPhase {
            try Data(#"{"phase":"\#(journalPhase)"}"#.utf8)
                .write(to: state.appending(path: "journal.json"))
        }
        return (root, updater, agents)
    }

    @Test func idleGuardianIsBootedOutAndDeleted() throws {
        let (root, updater, agents) = try fixture(journalPhase: "failed")
        defer { try? FileManager.default.removeItem(at: root) }
        var bootedOut: [String] = []
        let removal = LegacyUpdateGuardianRemoval(
            updaterRoot: updater,
            launchAgentsDirectory: agents,
            bootout: { bootedOut.append($0) }
        )

        #expect(removal.run())
        #expect(bootedOut.count == 1)
        #expect(bootedOut.first?.hasSuffix("/\(RuntimeConstants.legacyGuardianLaunchAgentLabel)") == true)
        #expect(!FileManager.default.fileExists(atPath: updater.appending(path: "bootstrap-v1").path))
        #expect(!FileManager.default.fileExists(atPath: updater.appending(path: "v1").path))
        #expect(!FileManager.default.fileExists(
            atPath: agents.appending(path: RuntimeConstants.legacyGuardianLaunchAgentPlistName).path
        ))
    }

    @Test func guardianInsideATransactionIsKept() throws {
        let (root, updater, agents) = try fixture(journalPhase: "rollingBack")
        defer { try? FileManager.default.removeItem(at: root) }
        var bootedOut: [String] = []
        let removal = LegacyUpdateGuardianRemoval(
            updaterRoot: updater,
            launchAgentsDirectory: agents,
            bootout: { bootedOut.append($0) }
        )

        #expect(!removal.run())
        #expect(bootedOut.isEmpty)
        #expect(FileManager.default.fileExists(atPath: updater.appending(path: "bootstrap-v1").path))
    }

    @Test func absentGuardianNeedsNothing() throws {
        let root = FileManager.default.temporaryDirectory
            .appending(path: "cw-legacy-\(UUID().uuidString)", directoryHint: .isDirectory)
        var bootedOut: [String] = []
        let removal = LegacyUpdateGuardianRemoval(
            updaterRoot: root.appending(path: "Updater"),
            launchAgentsDirectory: root.appending(path: "LaunchAgents"),
            bootout: { bootedOut.append($0) }
        )
        #expect(removal.run())
        #expect(bootedOut.isEmpty)
    }
}
