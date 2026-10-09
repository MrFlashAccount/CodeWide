import CodeWideShared
import Darwin
import Foundation
import OSLog

/// Installs the immutable V1 guardian once. App payload updates may repair the
/// launchd registration, but never replace bootstrap code or trust material.
@MainActor
final class GuardianBootstrapInstaller {
    private let fileManager: FileManager
    private let updaterRoot: URL
    private let launchAgentsDirectory: URL
    private let bundledBootstrap: URL
    private let e2eManifestBaseURL: URL?
    private let runLaunchctl: ([String]) throws -> Void
    private let logger = Logger(
        subsystem: RuntimeConstants.appBundleIdentifier,
        category: "UpdateGuardianBootstrap"
    )

    init(
        fileManager: FileManager = .default,
        updaterRoot: URL = RuntimeConstants.updaterDirectory,
        launchAgentsDirectory: URL? = nil,
        bundledBootstrap: URL? = nil,
        e2eManifestBaseURL: URL? = RuntimeConstants.validatedE2EManifestBaseURL(
            ProcessInfo.processInfo.environment[
                RuntimeConstants.e2eManifestBaseEnvironmentName
            ]
        ),
        runLaunchctl: (([String]) throws -> Void)? = nil
    ) throws {
        self.fileManager = fileManager
        self.updaterRoot = updaterRoot
        self.launchAgentsDirectory = launchAgentsDirectory
            ?? fileManager.homeDirectoryForCurrentUser
                .appending(path: "Library/LaunchAgents", directoryHint: .isDirectory)
        guard let bundledBootstrap = bundledBootstrap ?? Bundle.main.resourceURL?
            .appending(path: "UpdaterBootstrap", directoryHint: .isDirectory) else {
            throw BootstrapError.missingBundledBootstrap
        }
        self.bundledBootstrap = bundledBootstrap
        self.e2eManifestBaseURL = e2eManifestBaseURL
        self.runLaunchctl = runLaunchctl ?? Self.launchctl
    }

    func installIfNeeded() throws {
        let bootstrap = updaterRoot.appending(path: "bootstrap-v1", directoryHint: .isDirectory)
        let executable = bootstrap.appending(path: RuntimeConstants.guardianExecutableName)
        let trust = bootstrap.appending(path: "trust.json")
        let sourceExecutable = bundledBootstrap.appending(path: RuntimeConstants.guardianExecutableName)
        let sourceTrust = bundledBootstrap.appending(path: "trust.json")

        try ensurePrivateDirectory(updaterRoot)
        try ensurePrivateDirectory(updaterRoot.appending(path: "v1", directoryHint: .isDirectory))
        try ensurePrivateDirectory(HostUpdateIPC.ipcDirectory(updaterRoot: updaterRoot))
        try ensurePrivateDirectory(HostUpdateIPC.inbox(updaterRoot: updaterRoot))
        try ensurePrivateDirectory(HostUpdateIPC.outbox(updaterRoot: updaterRoot))
        try ensurePrivateDirectory(HostUpdateIPC.commands(updaterRoot: updaterRoot))

        let hasExecutable = fileManager.fileExists(atPath: executable.path)
        let hasTrust = fileManager.fileExists(atPath: trust.path)
        if hasExecutable != hasTrust {
            throw BootstrapError.partialExistingBootstrap
        }
        if !hasExecutable {
            guard fileManager.isExecutableFile(atPath: sourceExecutable.path),
                  fileManager.fileExists(atPath: sourceTrust.path) else {
                throw BootstrapError.missingBundledBootstrap
            }
            try ensurePrivateDirectory(bootstrap)
            try installImmutable(sourceExecutable, at: executable, permissions: 0o755)
            do {
                try installImmutable(sourceTrust, at: trust, permissions: 0o600)
            } catch {
                try? fileManager.removeItem(at: executable)
                throw error
            }
        }
        try validateImmutable(executable, executable: true)
        try validateImmutable(trust, executable: false)
        try installCanonicalApplicationRecord(bootstrap: bootstrap)
        try installLaunchAgent(executable: executable)
    }

    private func installCanonicalApplicationRecord(bootstrap: URL) throws {
        let destination = bootstrap.appending(path: "installation.json")
        let canonicalPath = Bundle.main.bundleURL.resolvingSymlinksInPath().path
        if fileManager.fileExists(atPath: destination.path) {
            let existing = try JSONDecoder().decode(
                GuardianInstallation.self,
                from: Data(contentsOf: destination)
            )
            guard existing.schemaVersion == HostUpdateIPC.bootstrapVersion,
                  existing.canonicalAppPath == canonicalPath else {
                throw BootstrapError.canonicalApplicationMoved
            }
            try validateImmutable(destination, executable: false)
            return
        }
        let record = GuardianInstallation(
            schemaVersion: HostUpdateIPC.bootstrapVersion,
            canonicalAppPath: canonicalPath,
            installedAt: UInt64(Date().timeIntervalSince1970 * 1_000)
        )
        try atomicWrite(try JSONEncoder().encode(record), to: destination, permissions: 0o600)
    }

    private func installLaunchAgent(executable: URL) throws {
        try ensurePrivateDirectory(launchAgentsDirectory)
        let plist = launchAgentsDirectory.appending(
            path: RuntimeConstants.guardianLaunchAgentPlistName
        )
        let logDirectory = updaterRoot.appending(path: "v1/logs", directoryHint: .isDirectory)
        try ensurePrivateDirectory(logDirectory)
        var value: [String: Any] = [
            "Label": RuntimeConstants.guardianLaunchAgentLabel,
            "ProgramArguments": [executable.path, "--serve", updaterRoot.path],
            "RunAtLoad": true,
            "KeepAlive": true,
            "ProcessType": "Background",
            "ThrottleInterval": 2,
            "StandardOutPath": logDirectory.appending(path: "guardian.log").path,
            "StandardErrorPath": logDirectory.appending(path: "guardian-error.log").path,
        ]
        #if CODEWIDE_E2E_NAMESPACE
        guard let manifestBase = e2eManifestBaseURL else {
            throw BootstrapError.invalidE2EManifestBase
        }
        value["EnvironmentVariables"] = [
            RuntimeConstants.e2eManifestBaseEnvironmentName: manifestBase.absoluteString,
        ]
        #endif
        let data = try PropertyListSerialization.data(
            fromPropertyList: value,
            format: .xml,
            options: 0
        )
        try atomicWrite(data, to: plist, permissions: 0o600)
        let domain = "gui/\(geteuid())"
        do {
            try runLaunchctl(["bootstrap", domain, plist.path])
        } catch {
            // Already-loaded agents reject bootstrap. Kickstart is the
            // idempotent registration/health action for that case.
            logger.debug("Guardian bootstrap returned \(error.localizedDescription, privacy: .private)")
        }
        // Start a stopped guardian, but never replace an already-running one.
        // The app is relaunched during rollback, while that guardian still
        // owns the rollback transaction; `kickstart -k` would kill it midway.
        try runLaunchctl(["kickstart", "\(domain)/\(RuntimeConstants.guardianLaunchAgentLabel)"])
    }

    private func installImmutable(_ source: URL, at destination: URL, permissions: Int16) throws {
        let data = try Data(contentsOf: source, options: .mappedIfSafe)
        try atomicWrite(data, to: destination, permissions: permissions)
    }

    private func atomicWrite(_ data: Data, to destination: URL, permissions: Int16) throws {
        let temporary = destination.deletingLastPathComponent()
            .appending(path: ".\(destination.lastPathComponent).\(UUID().uuidString).tmp")
        guard fileManager.createFile(
            atPath: temporary.path,
            contents: nil,
            attributes: [.posixPermissions: NSNumber(value: permissions)]
        ) else {
            throw BootstrapError.cannotCreate(temporary)
        }
        do {
            let handle = try FileHandle(forWritingTo: temporary)
            try handle.write(contentsOf: data)
            try handle.synchronize()
            try handle.close()
            guard rename(temporary.path, destination.path) == 0 else {
                throw BootstrapError.cannotCreate(destination)
            }
            try synchronizeDirectory(destination.deletingLastPathComponent())
        } catch {
            try? fileManager.removeItem(at: temporary)
            throw error
        }
    }

    private func ensurePrivateDirectory(_ url: URL) throws {
        try fileManager.createDirectory(
            at: url,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        try fileManager.setAttributes([.posixPermissions: 0o700], ofItemAtPath: url.path)
        let values = try url.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
        guard values.isDirectory == true, values.isSymbolicLink != true else {
            throw BootstrapError.unsafePath(url)
        }
    }

    private func validateImmutable(_ url: URL, executable: Bool) throws {
        let values = try url.resourceValues(forKeys: [
            .isRegularFileKey, .isSymbolicLinkKey,
        ])
        guard values.isRegularFile == true, values.isSymbolicLink != true else {
            throw BootstrapError.unsafePath(url)
        }
        let attributes = try fileManager.attributesOfItem(atPath: url.path)
        let mode = (attributes[.posixPermissions] as? NSNumber)?.intValue ?? 0
        let owner = (attributes[.ownerAccountID] as? NSNumber)?.uint32Value
        guard owner == geteuid(), mode & 0o022 == 0,
              !executable || mode & 0o100 != 0 else {
            throw BootstrapError.unsafePath(url)
        }
    }

    private func synchronizeDirectory(_ url: URL) throws {
        let descriptor = open(url.path, O_RDONLY | O_DIRECTORY)
        guard descriptor >= 0 else { throw BootstrapError.cannotSynchronize(url) }
        defer { close(descriptor) }
        guard fsync(descriptor) == 0 else { throw BootstrapError.cannotSynchronize(url) }
    }

    private static func launchctl(arguments: [String]) throws {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/launchctl")
        process.arguments = arguments
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        try process.run()
        process.waitUntilExit()
        guard process.terminationStatus == 0 else {
            throw BootstrapError.launchctl(process.terminationStatus)
        }
    }
}

private enum BootstrapError: LocalizedError {
    case missingBundledBootstrap
    case partialExistingBootstrap
    case cannotCreate(URL)
    case unsafePath(URL)
    case cannotSynchronize(URL)
    case launchctl(Int32)
    case canonicalApplicationMoved
    case invalidE2EManifestBase

    var errorDescription: String? {
        switch self {
        case .missingBundledBootstrap:
            "The signed app does not contain the update guardian bootstrap."
        case .partialExistingBootstrap:
            "The immutable update guardian bootstrap is incomplete and requires manual repair."
        case let .cannotCreate(url):
            "Cannot create the update guardian file at \(url.path)."
        case let .unsafePath(url):
            "The update guardian path is not a private regular user-owned path: \(url.path)."
        case let .cannotSynchronize(url):
            "Cannot synchronize the update guardian directory at \(url.path)."
        case let .launchctl(status):
            "launchctl exited with status \(status)."
        case .canonicalApplicationMoved:
            "CodeWide.app moved after update-guardian bootstrap; manual bootstrap is required."
        case .invalidE2EManifestBase:
            "The E2E update guardian requires a loopback manifest base URL."
        }
    }
}
