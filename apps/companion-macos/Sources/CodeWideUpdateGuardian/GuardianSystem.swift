import AppKit
import CodeWideShared
import Darwin
import Foundation

struct InstalledAppMetadata: Equatable {
    let version: String
    let build: String
    let sourceRevision: String
}

struct GuardianSystem: @unchecked Sendable {
    let fileManager: FileManager
    let updaterRoot: URL
    let environment: [String: String]
    let runProcess: (URL, [String]) throws -> ProcessResult
    let openApplication: @MainActor (URL) async throws -> Void

    init(
        fileManager: FileManager = .default,
        updaterRoot: URL,
        environment: [String: String] = ProcessInfo.processInfo.environment,
        runProcess: ((URL, [String]) throws -> ProcessResult)? = nil,
        openApplication: (@MainActor (URL) async throws -> Void)? = nil
    ) {
        self.fileManager = fileManager
        self.updaterRoot = updaterRoot
        self.environment = environment
        self.runProcess = runProcess ?? Self.process
        self.openApplication = openApplication ?? Self.launchApplication
    }

    func metadata(app: URL) throws -> InstalledAppMetadata {
        let data = try Data(contentsOf: app.appending(path: "Contents/Info.plist"))
        let raw = try PropertyListSerialization.propertyList(from: data, format: nil)
        guard let info = raw as? [String: Any],
              let version = info["CFBundleShortVersionString"] as? String,
              let build = info["CFBundleVersion"] as? String,
              let revision = info["CodeWideSourceRevision"] as? String,
              !version.isEmpty, !build.isEmpty,
              revision.range(of: #"^[0-9a-f]{40}$"#, options: .regularExpression) != nil else {
            throw GuardianFailure.manual("invalid_application_metadata")
        }
        return InstalledAppMetadata(version: version, build: build, sourceRevision: revision)
    }

    func verifyCodeSignature(app: URL) throws {
        let result = try runProcess(
            URL(fileURLWithPath: "/usr/bin/codesign"),
            ["--verify", "--deep", "--strict", "--verbose=2", app.path]
        )
        guard result.status == 0 else {
            throw GuardianFailure.precondition("application_signature_invalid")
        }
    }

    func runtimeObservation(now: UInt64) throws -> GuardianRuntimeObservation {
        let url = updaterRoot.appending(path: "v1/runtime-observation.json")
        let observation = try JSONDecoder().decode(
            GuardianRuntimeObservation.self,
            from: Data(contentsOf: url)
        )
        guard observation.observedAt <= now, now - observation.observedAt <= 5_000,
              observation.coreRunning else {
            throw GuardianFailure.precondition("runtime_observation_stale")
        }
        return observation
    }

    func launch(app: URL) async throws {
        try await openApplication(app)
    }

    func fenceForRollback(app: URL, deadline: Date) throws {
        let domain = "gui/\(geteuid())"
        // Do not kill the guardian itself. Stop the menu app and runtime, then
        // wait for Sparkle's installer/downloader to release the bundle tree.
        for application in NSRunningApplication.runningApplications(
            withBundleIdentifier: RuntimeConstants.appBundleIdentifier
        ) {
            _ = application.terminate()
        }
        let service = "\(domain)/\(RuntimeConstants.runtimeLaunchAgentLabel)"
        // Fence the registered job before signaling its current process. A
        // signal exit without the disable can make launchd immediately restart
        // the target runtime and reacquire the bundle during the exchange.
        _ = try? runProcess(
            URL(fileURLWithPath: "/bin/launchctl"),
            ["disable", service]
        )
        _ = try? runProcess(
            URL(fileURLWithPath: "/bin/launchctl"),
            ["kill", "SIGTERM", service]
        )
        while Date() < deadline {
            let result = try runProcess(
                URL(fileURLWithPath: "/usr/sbin/lsof"),
                ["-t", "+D", app.path]
            )
            if result.status != 0 || result.stdout.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                return
            }
            Thread.sleep(forTimeInterval: 0.1)
        }
        throw GuardianFailure.internalError("installer_ownership_timeout")
    }

    func reRegisterRuntime(app: URL) throws {
        let domain = "gui/\(geteuid())"
        let service = "\(domain)/\(RuntimeConstants.runtimeLaunchAgentLabel)"
        let enable = try runProcess(
            URL(fileURLWithPath: "/bin/launchctl"),
            ["enable", service]
        )
        guard enable.status == 0 else {
            throw GuardianFailure.internalError("runtime_registration_failed")
        }
        let registration = try runProcess(
            URL(fileURLWithPath: "/bin/launchctl"),
            ["print", service]
        )
        if registration.status != 0 {
            let plist = app.appending(
                path: "Contents/Library/LaunchAgents/\(RuntimeConstants.launchAgentPlistName)"
            )
            guard fileManager.fileExists(atPath: plist.path) else {
                throw GuardianFailure.internalError("runtime_registration_plist_missing")
            }
            let bootstrap = try runProcess(
                URL(fileURLWithPath: "/bin/launchctl"),
                ["bootstrap", domain, plist.path]
            )
            guard bootstrap.status == 0 else {
                throw GuardianFailure.internalError("runtime_registration_failed")
            }
        }
        let result = try runProcess(
            URL(fileURLWithPath: "/bin/launchctl"),
            ["kickstart", "-k", service]
        )
        guard result.status == 0 else {
            throw GuardianFailure.internalError("runtime_registration_failed")
        }
    }

    func download(_ url: URL, to destination: URL) async throws {
        var request = URLRequest(url: try resolvedDownloadURL(url))
        request.timeoutInterval = 30
        request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        let (temporary, response) = try await URLSession.shared.download(for: request)
        guard let response = response as? HTTPURLResponse,
              response.statusCode == 200 else {
            throw GuardianFailure.precondition("download_failed")
        }
        let size = try temporary.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
        guard size > 0, size <= 512 * 1_024 * 1_024 else {
            throw GuardianFailure.precondition("download_size_invalid")
        }
        if fileManager.fileExists(atPath: destination.path) {
            try fileManager.removeItem(at: destination)
        }
        try fileManager.moveItem(at: temporary, to: destination)
        try fileManager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: destination.path)
    }

    /// Keeps signed E2E manifests production-shaped while routing their
    /// admitted GitHub artifacts to the isolated loopback fixture server.
    func resolvedDownloadURL(_ url: URL) throws -> URL {
        #if CODEWIDE_E2E_NAMESPACE
        guard let base = RuntimeConstants.validatedE2EManifestBaseURL(
            environment[RuntimeConstants.e2eManifestBaseEnvironmentName]
        ) else {
            throw GuardianFailure.precondition("e2e_artifact_url_invalid")
        }
        if isContainedLoopbackFixtureURL(url, under: base) {
            return url
        }
        let prefix = "/MrFlashAccount/CodeWide/releases/download/"
        guard url.scheme == "https",
              url.host == "github.com",
              url.port == nil,
              url.user == nil,
              url.password == nil,
              url.query == nil,
              url.fragment == nil,
              url.path.hasPrefix(prefix) else {
            throw GuardianFailure.precondition("e2e_artifact_url_invalid")
        }
        let relativePath = String(url.path.dropFirst(prefix.count))
        let components = relativePath.split(separator: "/", omittingEmptySubsequences: false)
        guard !relativePath.isEmpty,
              components.allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." }) else {
            throw GuardianFailure.precondition("e2e_artifact_url_invalid")
        }
        return base.appending(path: "releases/download/\(relativePath)")
        #else
        return url
        #endif
    }

    #if CODEWIDE_E2E_NAMESPACE
    private func isContainedLoopbackFixtureURL(_ candidate: URL, under base: URL) -> Bool {
        guard candidate.scheme == base.scheme,
              candidate.host == base.host,
              candidate.port == base.port,
              candidate.user == nil,
              candidate.password == nil,
              candidate.query == nil,
              candidate.fragment == nil else {
            return false
        }
        let baseComponents = base.pathComponents.filter { $0 != "/" }
        let candidateComponents = candidate.pathComponents.filter { $0 != "/" }
        guard candidateComponents.count > baseComponents.count,
              !candidateComponents.contains(where: { $0 == "." || $0 == ".." }) else {
            return false
        }
        return zip(baseComponents, candidateComponents).allSatisfy(==)
    }
    #endif

    /// Mounts a verified DMG read-only, executes `body` against CodeWide.app,
    /// and always detaches the image. The caller verifies the DMG digest first.
    func withMountedApplication<T>(dmg: URL, body: (URL) throws -> T) throws -> T {
        let attach = try runProcess(
            URL(fileURLWithPath: "/usr/bin/hdiutil"),
            ["attach", "-readonly", "-nobrowse", "-plist", dmg.path]
        )
        guard attach.status == 0,
              let data = attach.stdout.data(using: .utf8),
              let plist = try PropertyListSerialization.propertyList(from: data, format: nil)
                as? [String: Any],
              let entities = plist["system-entities"] as? [[String: Any]],
              let mount = entities.compactMap({ $0["mount-point"] as? String }).first else {
            throw GuardianFailure.manual("baseline_image_mount_failed")
        }
        defer {
            _ = try? runProcess(
                URL(fileURLWithPath: "/usr/bin/hdiutil"),
                ["detach", mount, "-force"]
            )
        }
        let application = URL(fileURLWithPath: mount, isDirectory: true)
            .appending(path: "CodeWide.app", directoryHint: .isDirectory)
        guard fileManager.fileExists(atPath: application.path) else {
            throw GuardianFailure.manual("baseline_application_missing")
        }
        return try body(application)
    }

    private static func process(_ executable: URL, _ arguments: [String]) throws -> ProcessResult {
        let process = Process()
        let output = Pipe()
        let error = Pipe()
        process.executableURL = executable
        process.arguments = arguments
        process.standardOutput = output
        process.standardError = error
        try process.run()
        process.waitUntilExit()
        return ProcessResult(
            status: process.terminationStatus,
            stdout: String(
                data: output.fileHandleForReading.readDataToEndOfFile(),
                encoding: .utf8
            ) ?? "",
            stderr: String(
                data: error.fileHandleForReading.readDataToEndOfFile(),
                encoding: .utf8
            ) ?? ""
        )
    }

    @MainActor
    private static func launchApplication(_ url: URL) async throws {
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = false
        configuration.addsToRecentItems = false
        _ = try await NSWorkspace.shared.openApplication(at: url, configuration: configuration)
    }
}

struct ProcessResult: Sendable {
    let status: Int32
    let stdout: String
    let stderr: String
}
