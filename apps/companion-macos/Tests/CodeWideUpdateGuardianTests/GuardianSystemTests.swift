import CodeWideShared
import Darwin
import Foundation
import Testing
@testable import CodeWideUpdateGuardian

@Suite("Update guardian system boundary")
struct GuardianSystemTests {
    @Test @MainActor func appWakeUsesTheExactCanonicalURLAndPropagatesFailure() async throws {
        let expected = URL(fileURLWithPath: "/Applications/CodeWide.app", isDirectory: true)
        var opened: URL?
        let success = GuardianSystem(
            updaterRoot: FileManager.default.temporaryDirectory,
            openApplication: { opened = $0 }
        )
        try await success.launch(app: expected)
        #expect(opened == expected)

        let failure = GuardianSystem(
            updaterRoot: FileManager.default.temporaryDirectory,
            openApplication: { _ in throw TestFailure.appLaunch }
        )
        await #expect(throws: TestFailure.self) {
            try await failure.launch(app: expected)
        }
    }

    @Test func signatureVerificationUsesStrictCodesign() throws {
        let root = FileManager.default.temporaryDirectory
        var captured: [String] = []
        let system = GuardianSystem(
            updaterRoot: root,
            runProcess: { executable, arguments in
                captured = [executable.path] + arguments
                return ProcessResult(status: 0, stdout: "", stderr: "")
            }
        )

        try system.verifyCodeSignature(app: URL(fileURLWithPath: "/tmp/Test.app"))

        #expect(captured == [
            "/usr/bin/codesign", "--verify", "--deep", "--strict", "--verbose=2", "/tmp/Test.app",
        ])
    }

    @Test func artifactDownloadURLRespectsTheBuildNamespace() throws {
        let admitted = try #require(URL(
            string: "https://github.com/MrFlashAccount/CodeWide/releases/download/v1.2.3/CodeWide.dmg"
        ))
        let system = GuardianSystem(
            updaterRoot: FileManager.default.temporaryDirectory,
            environment: [
                RuntimeConstants.e2eManifestBaseEnvironmentName:
                    "http://127.0.0.1:18766/host",
            ]
        )

        #if CODEWIDE_E2E_NAMESPACE
        #expect(
            try system.resolvedDownloadURL(admitted).absoluteString
                == "http://127.0.0.1:18766/host/releases/download/v1.2.3/CodeWide.dmg"
        )
        let manifest = try #require(URL(
            string: "http://127.0.0.1:18766/host/latest/release-manifest.json"
        ))
        #expect(try system.resolvedDownloadURL(manifest) == manifest)
        #expect(throws: (any Error).self) {
            try system.resolvedDownloadURL(
                #require(URL(string: "http://127.0.0.1:18766/feed/CodeWide.dmg"))
            )
        }
        for rejected in [
            "http://127.0.0.1:18766/hostile/release-manifest.json",
            "http://127.0.0.1:18767/host/latest/release-manifest.json",
            "http://user@127.0.0.1:18766/host/latest/release-manifest.json",
            "http://127.0.0.1:18766/host/latest/release-manifest.json?unexpected=1",
        ] {
            #expect(throws: (any Error).self) {
                try system.resolvedDownloadURL(#require(URL(string: rejected)))
            }
        }
        #else
        #expect(try system.resolvedDownloadURL(admitted) == admitted)
        #endif
    }

    @Test func invalidSignatureAndRuntimeRegistrationAreHardFailures() throws {
        let root = FileManager.default.temporaryDirectory
        let system = GuardianSystem(
            updaterRoot: root,
            runProcess: { _, _ in ProcessResult(status: 1, stdout: "", stderr: "failure") }
        )
        #expect(throws: (any Error).self) {
            try system.verifyCodeSignature(app: URL(fileURLWithPath: "/tmp/Test.app"))
        }
        #expect(throws: (any Error).self) {
            try system.reRegisterRuntime(app: URL(fileURLWithPath: "/tmp/Test.app"))
        }
    }

    @Test func restoredRuntimeIsEnabledVerifiedAndKickstarted() throws {
        var actions: [String] = []
        let system = GuardianSystem(
            updaterRoot: FileManager.default.temporaryDirectory,
            runProcess: { _, arguments in
                actions.append(arguments.first ?? "")
                return ProcessResult(status: 0, stdout: "", stderr: "")
            }
        )

        try system.reRegisterRuntime(app: URL(fileURLWithPath: "/tmp/CodeWide.app"))

        #expect(actions == ["enable", "print", "kickstart"])
    }

    @Test func missingRuntimeRegistrationUsesCanonicalBundledPlist() throws {
        let root = FileManager.default.temporaryDirectory
            .appending(path: UUID().uuidString, directoryHint: .isDirectory)
        defer { try? FileManager.default.removeItem(at: root) }
        let plist = root.appending(
            path: "Contents/Library/LaunchAgents/\(RuntimeConstants.launchAgentPlistName)"
        )
        try FileManager.default.createDirectory(
            at: plist.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try Data().write(to: plist)
        var calls: [[String]] = []
        let system = GuardianSystem(
            updaterRoot: FileManager.default.temporaryDirectory,
            runProcess: { _, arguments in
                calls.append(arguments)
                return ProcessResult(
                    status: arguments.first == "print" ? 1 : 0,
                    stdout: "",
                    stderr: ""
                )
            }
        )

        try system.reRegisterRuntime(app: root)

        #expect(calls.contains(["bootstrap", "gui/\(geteuid())", plist.path]))
        #expect(calls.last == [
            "kickstart", "-k", "gui/\(geteuid())/\(RuntimeConstants.runtimeLaunchAgentLabel)",
        ])
    }

    @Test func rollbackRefusesToMoveABundleStillOwnedByAnInstaller() {
        let system = GuardianSystem(
            updaterRoot: FileManager.default.temporaryDirectory,
            runProcess: { executable, _ in
                if executable.path == "/usr/sbin/lsof" {
                    return ProcessResult(status: 0, stdout: "123\n", stderr: "")
                }
                return ProcessResult(status: 0, stdout: "", stderr: "")
            }
        )
        #expect(throws: (any Error).self) {
            try system.fenceForRollback(
                app: URL(fileURLWithPath: "/tmp/CodeWide.app"),
                deadline: Date().addingTimeInterval(0.02)
            )
        }
    }

    @Test func rollbackDisablesRuntimeBeforeCheckingBundleOwnership() throws {
        var calls: [[String]] = []
        let system = GuardianSystem(
            updaterRoot: FileManager.default.temporaryDirectory,
            runProcess: { executable, arguments in
                calls.append([executable.path] + arguments)
                return ProcessResult(status: 1, stdout: "", stderr: "")
            }
        )

        try system.fenceForRollback(
            app: URL(fileURLWithPath: "/tmp/CodeWide.app"),
            deadline: Date().addingTimeInterval(1)
        )

        #expect(calls.contains(where: {
            $0.first == "/bin/launchctl"
                && $0.dropFirst().first == "disable"
                && $0.last?.hasSuffix("/\(RuntimeConstants.runtimeLaunchAgentLabel)") == true
        }))
        #expect(calls.contains(where: {
            $0.first == "/bin/launchctl"
                && $0.dropFirst().first == "kill"
                && $0.last?.hasSuffix("/\(RuntimeConstants.runtimeLaunchAgentLabel)") == true
        }))
    }
}

private enum TestFailure: Error {
    case appLaunch
}
