import CodeWideShared
import Darwin
import Foundation
import Testing
@testable import CodeWide

@Suite("Immutable update guardian bootstrap")
@MainActor
struct GuardianBootstrapInstallerTests {
    @Test func installsOutsideTheApplicationAndNeverReplacesBootstrapPayload() throws {
        let root = try temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let bundled = root.appending(path: "bundle", directoryHint: .isDirectory)
        let updater = root.appending(path: "support/Updater", directoryHint: .isDirectory)
        let launchAgents = root.appending(path: "LaunchAgents", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: bundled, withIntermediateDirectories: true)
        let sourceExecutable = bundled.appending(path: "CodeWideUpdateGuardian")
        let sourceTrust = bundled.appending(path: "trust.json")
        try Data("guardian-v1".utf8).write(to: sourceExecutable)
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o700],
            ofItemAtPath: sourceExecutable.path
        )
        try Data(#"{"schemaVersion":1}"#.utf8).write(to: sourceTrust)
        var launchctlCalls: [[String]] = []
        let installer = try GuardianBootstrapInstaller(
            updaterRoot: updater,
            launchAgentsDirectory: launchAgents,
            bundledBootstrap: bundled,
            e2eManifestBaseURL: URL(string: "http://127.0.0.1:18766/host"),
            runLaunchctl: { launchctlCalls.append($0) }
        )

        try installer.installIfNeeded()
        try Data("guardian-v2-must-not-replace".utf8).write(to: sourceExecutable)
        try installer.installIfNeeded()

        let installed = updater.appending(path: "bootstrap-v1/CodeWideUpdateGuardian")
        #expect(try String(contentsOf: installed, encoding: .utf8) == "guardian-v1")
        #expect(!installed.path.hasPrefix(Bundle.main.bundleURL.path + "/"))
        let launchAgent = launchAgents.appending(
            path: RuntimeConstants.guardianLaunchAgentPlistName
        )
        #expect(FileManager.default.fileExists(atPath: launchAgent.path))
        #if CODEWIDE_E2E_NAMESPACE
        let data = try Data(contentsOf: launchAgent)
        let raw = try PropertyListSerialization.propertyList(from: data, format: nil)
        let plist = try #require(raw as? [String: Any])
        let environment = try #require(plist["EnvironmentVariables"] as? [String: String])
        #expect(
            environment[RuntimeConstants.e2eManifestBaseEnvironmentName]
                == "http://127.0.0.1:18766/host"
        )
        #endif
        let kickstart = try #require(launchctlCalls.last { $0.first == "kickstart" })
        #expect(kickstart == [
            "kickstart", "gui/\(geteuid())/\(RuntimeConstants.guardianLaunchAgentLabel)",
        ])
        #expect(!launchctlCalls.joined().contains("-k"))
    }

    @Test func alreadyRegisteredGuardianIsStartedWithoutForceRestart() throws {
        let root = try temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let bundled = root.appending(path: "bundle", directoryHint: .isDirectory)
        let updater = root.appending(path: "support/Updater", directoryHint: .isDirectory)
        let launchAgents = root.appending(path: "LaunchAgents", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: bundled, withIntermediateDirectories: true)
        let sourceExecutable = bundled.appending(path: "CodeWideUpdateGuardian")
        try Data("guardian-v1".utf8).write(to: sourceExecutable)
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o700],
            ofItemAtPath: sourceExecutable.path
        )
        try Data(#"{"schemaVersion":1}"#.utf8).write(
            to: bundled.appending(path: "trust.json")
        )
        var launchctlCalls: [[String]] = []
        let installer = try GuardianBootstrapInstaller(
            updaterRoot: updater,
            launchAgentsDirectory: launchAgents,
            bundledBootstrap: bundled,
            e2eManifestBaseURL: URL(string: "http://127.0.0.1:18766/host"),
            runLaunchctl: { arguments in
                launchctlCalls.append(arguments)
                if arguments.first == "bootstrap" {
                    throw TestFailure.alreadyRegistered
                }
            }
        )

        try installer.installIfNeeded()

        #expect(launchctlCalls.count == 2)
        #expect(launchctlCalls[0].first == "bootstrap")
        #expect(launchctlCalls[1] == [
            "kickstart", "gui/\(geteuid())/\(RuntimeConstants.guardianLaunchAgentLabel)",
        ])
        #expect(!launchctlCalls.joined().contains("-k"))
    }

    @Test func partialBootstrapRequiresManualRepair() throws {
        let root = try temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let bundled = root.appending(path: "bundle", directoryHint: .isDirectory)
        let updater = root.appending(path: "support/Updater", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(
            at: updater.appending(path: "bootstrap-v1"),
            withIntermediateDirectories: true
        )
        try FileManager.default.createDirectory(at: bundled, withIntermediateDirectories: true)
        let executable = updater.appending(path: "bootstrap-v1/CodeWideUpdateGuardian")
        try Data("orphan".utf8).write(to: executable)
        let installer = try GuardianBootstrapInstaller(
            updaterRoot: updater,
            launchAgentsDirectory: root.appending(path: "LaunchAgents"),
            bundledBootstrap: bundled,
            runLaunchctl: { _ in }
        )

        #expect(throws: (any Error).self) {
            try installer.installIfNeeded()
        }
    }

    private func temporaryRoot() throws -> URL {
        let root = FileManager.default.temporaryDirectory
            .appending(path: "codewide-bootstrap-tests-\(UUID().uuidString)", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        return root
    }
}

private enum TestFailure: Error {
    case alreadyRegistered
}
