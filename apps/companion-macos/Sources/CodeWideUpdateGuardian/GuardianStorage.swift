import CodeWideShared
import CryptoKit
import Darwin
import Foundation

struct GuardianStoredState: Codable {
    var schemaVersion: UInt16 = 1
    var receipt: GuardianBootstrapReceipt?
    var available: AvailableHostUpdatePayload?
    var idempotency: [String: String] = [:]
}

struct GuardianOperationContext: Codable {
    let currentVersion: String
    let target: ReleaseTargetPayload
    let targetFingerprint: String
    /// Optional so an immutable V1 guardian can still recover journals written
    /// before retry identity became part of the private context record.
    let idempotencyKey: String?
    let appCommand: GuardianAppCommand
    var snapshotPath: String?
    var targetBundleTreeDigest: String?
    let identityTreeDigest: String
    let deviceRegistryDigest: String
    var rollbackRestoredAt: UInt64? = nil
}

struct GuardianStorage {
    let root: URL
    let fileManager: FileManager

    init(root: URL, fileManager: FileManager = .default) throws {
        self.root = root
        self.fileManager = fileManager
        for directory in [
            root,
            root.appending(path: "bootstrap-v1", directoryHint: .isDirectory),
            root.appending(path: "v1", directoryHint: .isDirectory),
            HostUpdateIPC.ipcDirectory(updaterRoot: root),
            HostUpdateIPC.inbox(updaterRoot: root),
            HostUpdateIPC.outbox(updaterRoot: root),
            HostUpdateIPC.commands(updaterRoot: root),
            operationsDirectory,
        ] {
            try privateDirectory(directory)
        }
    }

    var bootstrapDirectory: URL {
        root.appending(path: "bootstrap-v1", directoryHint: .isDirectory)
    }

    var stateURL: URL { root.appending(path: "v1/state.json") }
    var journalURL: URL { root.appending(path: "v1/journal.json") }
    var contextURL: URL { root.appending(path: "v1/operation-context.json") }
    var capabilityURL: URL { root.appending(path: "v1/capability-v1.json") }
    var operationsDirectory: URL {
        root.appending(path: "v1/operations", directoryHint: .isDirectory)
    }

    func trust() throws -> GuardianBootstrapTrust {
        try decode(GuardianBootstrapTrust.self, from: bootstrapDirectory.appending(path: "trust.json"))
    }

    func installation() throws -> GuardianInstallation {
        try decode(GuardianInstallation.self, from: bootstrapDirectory.appending(path: "installation.json"))
    }

    func loadState() throws -> GuardianStoredState {
        guard fileManager.fileExists(atPath: stateURL.path) else { return GuardianStoredState() }
        let state = try decode(GuardianStoredState.self, from: stateURL)
        guard state.schemaVersion == HostUpdateIPC.journalVersion else {
            throw GuardianFailure.manual("unsupported_guardian_state")
        }
        return state
    }

    func saveState(_ state: GuardianStoredState) throws {
        try write(state, to: stateURL)
    }

    /// Publishes apply capability only after the guardian has independently
    /// certified the installed bundle against signed release payload bytes.
    func publishCapability(_ receipt: GuardianBootstrapReceipt) throws {
        try write(receipt, to: capabilityURL)
    }

    func publishedCapability() throws -> GuardianBootstrapReceipt? {
        guard fileManager.fileExists(atPath: capabilityURL.path) else { return nil }
        return try decode(GuardianBootstrapReceipt.self, from: capabilityURL)
    }

    func revokeCapability() throws {
        guard fileManager.fileExists(atPath: capabilityURL.path) else { return }
        try fileManager.removeItem(at: capabilityURL)
        try synchronizeDirectory(capabilityURL.deletingLastPathComponent())
    }

    func loadJournal() throws -> HostUpdateJournalPayload? {
        guard fileManager.fileExists(atPath: journalURL.path) else { return nil }
        let journal = try decode(HostUpdateJournalPayload.self, from: journalURL)
        guard journal.journalVersion == HostUpdateIPC.journalVersion else {
            throw GuardianFailure.manual("unsupported_journal")
        }
        return journal
    }

    func saveJournal(_ journal: HostUpdateJournalPayload) throws {
        try write(journal, to: journalURL)
    }

    func loadContext() throws -> GuardianOperationContext {
        try decode(GuardianOperationContext.self, from: contextURL)
    }

    func saveContext(_ context: GuardianOperationContext) throws {
        try write(context, to: contextURL)
    }

    func saveTerminal(_ operation: HostUpdateOperationPayload) throws {
        let destination = operationsDirectory.appending(path: "\(operation.operationId).json")
        guard !fileManager.fileExists(atPath: destination.path) else { return }
        try write(operation, to: destination)
    }

    func loadTerminal(_ operationID: String) throws -> HostUpdateOperationPayload? {
        guard isSafeIdentifier(operationID) else { throw GuardianFailure.notFound }
        let url = operationsDirectory.appending(path: "\(operationID).json")
        guard fileManager.fileExists(atPath: url.path) else { return nil }
        return try decode(HostUpdateOperationPayload.self, from: url)
    }

    func appCommandURL(operationID: String) -> URL {
        HostUpdateIPC.commands(updaterRoot: root).appending(path: "\(operationID).json")
    }

    func appEventURL(operationID: String) -> URL {
        HostUpdateIPC.commands(updaterRoot: root).appending(path: "\(operationID).event.json")
    }

    func writeAppCommand(_ command: GuardianAppCommand) throws {
        try write(command, to: appCommandURL(operationID: command.operationId))
    }

    func consumeAppEvent(operationID: String) throws -> GuardianAppEvent? {
        let url = appEventURL(operationID: operationID)
        guard fileManager.fileExists(atPath: url.path) else { return nil }
        let event = try decode(GuardianAppEvent.self, from: url)
        try fileManager.removeItem(at: url)
        try synchronizeDirectory(url.deletingLastPathComponent())
        return event
    }

    func writeIPCResponse<Payload: Codable & Sendable>(
        _ response: GuardianIPCResponse<Payload>
    ) throws {
        let destination = HostUpdateIPC.outbox(updaterRoot: root)
            .appending(path: "\(response.requestId).json")
        try write(response, to: destination)
    }

    func pendingRequests() throws -> [URL] {
        try fileManager.contentsOfDirectory(
            at: HostUpdateIPC.inbox(updaterRoot: root),
            includingPropertiesForKeys: [.isRegularFileKey, .isSymbolicLinkKey]
        )
        .filter { $0.pathExtension == "json" && !$0.lastPathComponent.hasPrefix(".") }
        .sorted { $0.lastPathComponent < $1.lastPathComponent }
    }

    func consumeRequest(_ url: URL) throws -> GuardianIPCRequest {
        let values = try url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
        guard values.isRegularFile == true, values.isSymbolicLink != true else {
            throw GuardianFailure.invalid("unsafe_ipc_request")
        }
        let request = try decode(GuardianIPCRequest.self, from: url)
        try fileManager.removeItem(at: url)
        try synchronizeDirectory(url.deletingLastPathComponent())
        return request
    }

    func probeAtomicSiblingRename(canonicalApp: URL) throws {
        let parent = canonicalApp.deletingLastPathComponent()
        guard fileManager.isWritableFile(atPath: canonicalApp.path),
              fileManager.isWritableFile(atPath: parent.path) else {
            throw GuardianFailure.manual("authorization_required")
        }
        let token = UUID().uuidString
        let first = parent.appending(path: ".codewide-update-probe-a-\(token)")
        let second = parent.appending(path: ".codewide-update-probe-b-\(token)")
        defer {
            try? fileManager.removeItem(at: first)
            try? fileManager.removeItem(at: second)
        }
        try fileManager.createDirectory(at: first, withIntermediateDirectories: false)
        try fileManager.createDirectory(at: second, withIntermediateDirectories: false)
        try Data("a".utf8).write(to: first.appending(path: "a"))
        try Data("b".utf8).write(to: second.appending(path: "b"))
        try atomicExchange(first, second)
        guard fileManager.fileExists(atPath: first.appending(path: "b").path),
              fileManager.fileExists(atPath: second.appending(path: "a").path) else {
            throw GuardianFailure.manual("atomic_exchange_probe_failed")
        }
        try atomicExchange(first, second)
        guard fileManager.fileExists(atPath: first.appending(path: "a").path),
              fileManager.fileExists(atPath: second.appending(path: "b").path) else {
            throw GuardianFailure.manual("atomic_exchange_probe_failed")
        }
        try synchronizeDirectory(parent)
    }

    func createSnapshot(canonicalApp: URL, operationID: String) throws -> URL {
        guard isSafeIdentifier(operationID) else {
            throw GuardianFailure.invalid("unsafe_operation_id")
        }
        let snapshot = canonicalApp.deletingLastPathComponent()
            .appending(path: ".CodeWide.previous-\(operationID).app")
        if fileManager.fileExists(atPath: snapshot.path) {
            guard try bundleTreeDigest(canonicalApp) == bundleTreeDigest(snapshot) else {
                throw GuardianFailure.conflict("snapshot_exists_with_different_payload")
            }
            return snapshot
        }
        try fileManager.copyItem(at: canonicalApp, to: snapshot)
        let sourceDigest = try bundleTreeDigest(canonicalApp)
        let snapshotDigest = try bundleTreeDigest(snapshot)
        guard sourceDigest == snapshotDigest else {
            try? fileManager.removeItem(at: snapshot)
            throw GuardianFailure.internalError(
                "snapshot_verification_failed:\(sourceDigest):\(snapshotDigest)"
            )
        }
        try synchronizeTree(snapshot)
        try synchronizeDirectory(snapshot.deletingLastPathComponent())
        return snapshot
    }

    func restoreSnapshot(snapshot: URL, canonicalApp: URL) throws {
        guard snapshot.deletingLastPathComponent() == canonicalApp.deletingLastPathComponent() else {
            throw GuardianFailure.internalError("snapshot_not_sibling")
        }
        if fileManager.fileExists(atPath: canonicalApp.path) {
            try atomicExchange(snapshot, canonicalApp)
        }
        else {
            try fileManager.moveItem(at: snapshot, to: canonicalApp)
        }
        try synchronizeDirectory(canonicalApp.deletingLastPathComponent())
    }

    func discardSnapshot(_ snapshot: URL) throws {
        guard fileManager.fileExists(atPath: snapshot.path) else { return }
        try fileManager.removeItem(at: snapshot)
        try synchronizeDirectory(snapshot.deletingLastPathComponent())
    }

    /// Hashes a bundle independently of its outer directory name and mutable
    /// filesystem metadata. Relative NFC paths, entry kind, symlink target,
    /// POSIX mode and regular-file bytes are included; inode, timestamps,
    /// owner/group and extended attributes are intentionally excluded.
    func bundleTreeDigest(_ bundle: URL) throws -> String {
        var resolved = [CChar](repeating: 0, count: Int(PATH_MAX))
        guard realpath(bundle.path, &resolved) != nil else {
            throw GuardianFailure.internalError("bundle_realpath_failed")
        }
        let resolvedPath = String(
            decoding: resolved.prefix { $0 != 0 }.map { UInt8(bitPattern: $0) },
            as: UTF8.self
        )
        let normalizedBundle = URL(
            fileURLWithPath: resolvedPath,
            isDirectory: true
        )
        let keys: [URLResourceKey] = [
            .isRegularFileKey, .isDirectoryKey, .isSymbolicLinkKey, .fileSizeKey,
        ]
        var enumerationError: Error?
        guard let enumerator = fileManager.enumerator(
            at: normalizedBundle,
            includingPropertiesForKeys: keys,
            options: [],
            errorHandler: { _, error in
                enumerationError = error
                return false
            }
        ) else {
            throw GuardianFailure.internalError("bundle_enumeration_failed")
        }
        let prefix = normalizedBundle.path + "/"
        let entries = try enumerator.compactMap { $0 as? URL }.map { url in
            guard url.path.hasPrefix(prefix) else {
                throw GuardianFailure.internalError("bundle_entry_outside_root")
            }
            return (
                url: url,
                relative: String(url.path.dropFirst(prefix.count))
                    .precomposedStringWithCanonicalMapping
            )
        }
        .sorted { $0.relative < $1.relative }
        if let enumerationError { throw enumerationError }
        var digest = SHA256()
        var previousRelative: String?
        for entry in entries {
            guard entry.relative != previousRelative else {
                throw GuardianFailure.manual("ambiguous_normalized_bundle_path")
            }
            previousRelative = entry.relative
            let url = entry.url
            let values = try url.resourceValues(forKeys: Set(keys))
            let attributes = try fileManager.attributesOfItem(atPath: url.path)
            let mode = (attributes[.posixPermissions] as? NSNumber)?.uint16Value ?? 0
            digest.update(data: Data(entry.relative.utf8))
            digest.update(data: withUnsafeBytes(of: mode.bigEndian) { Data($0) })
            if values.isSymbolicLink == true {
                digest.update(data: Data([2]))
                digest.update(data: Data(try fileManager.destinationOfSymbolicLink(atPath: url.path).utf8))
            } else if values.isDirectory == true {
                digest.update(data: Data([1]))
            } else if values.isRegularFile == true {
                digest.update(data: Data([0]))
                digest.update(data: try Data(contentsOf: url, options: .mappedIfSafe))
            } else {
                throw GuardianFailure.manual("unsupported_bundle_entry")
            }
        }
        return digest.finalize().map { String(format: "%02x", $0) }.joined()
    }

    /// Canonical digest of durable device authorization identities. Connection
    /// timestamps and unclaimed pairing challenges are expected to change
    /// during a restart, while every other device field remains protected.
    func deviceRegistryIdentityDigest(_ registry: URL) throws -> String {
        let raw = try JSONSerialization.jsonObject(with: Data(contentsOf: registry))
        guard let object = raw as? [String: Any],
              let version = object["version"] as? NSNumber,
              let devices = object["devices"] as? [[String: Any]] else {
            throw GuardianFailure.internalError("device_registry_invalid")
        }
        var canonicalDevices: [[String: Any]] = []
        canonicalDevices.reserveCapacity(devices.count)
        for var device in devices {
            guard let identifier = device["id"] as? String, !identifier.isEmpty else {
                throw GuardianFailure.internalError("device_registry_invalid")
            }
            device.removeValue(forKey: "lastSeenAt")
            canonicalDevices.append(device)
        }
        canonicalDevices.sort {
            ($0["id"] as? String ?? "") < ($1["id"] as? String ?? "")
        }
        let canonical: [String: Any] = [
            "version": version,
            "devices": canonicalDevices,
        ]
        let bytes = try JSONSerialization.data(withJSONObject: canonical, options: [.sortedKeys])
        return SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
    }

    func write<T: Encodable>(_ value: T, to destination: URL) throws {
        let data = try JSONEncoder().encode(value)
        let temporary = destination.deletingLastPathComponent()
            .appending(path: ".\(destination.lastPathComponent).\(UUID().uuidString).tmp")
        guard fileManager.createFile(
            atPath: temporary.path,
            contents: nil,
            attributes: [.posixPermissions: 0o600]
        ) else {
            throw GuardianFailure.internalError("create_failed")
        }
        do {
            let handle = try FileHandle(forWritingTo: temporary)
            try handle.write(contentsOf: data)
            try handle.synchronize()
            try handle.close()
            guard rename(temporary.path, destination.path) == 0 else {
                throw GuardianFailure.internalError("atomic_rename_failed")
            }
            try synchronizeDirectory(destination.deletingLastPathComponent())
        } catch {
            try? fileManager.removeItem(at: temporary)
            throw error
        }
    }

    private func decode<T: Decodable>(_ type: T.Type, from url: URL) throws -> T {
        try JSONDecoder().decode(type, from: Data(contentsOf: url, options: .mappedIfSafe))
    }

    private func privateDirectory(_ url: URL) throws {
        try fileManager.createDirectory(
            at: url,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        try fileManager.setAttributes([.posixPermissions: 0o700], ofItemAtPath: url.path)
        let values = try url.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
        guard values.isDirectory == true, values.isSymbolicLink != true else {
            throw GuardianFailure.manual("unsafe_guardian_directory")
        }
    }

    private func synchronizeTree(_ root: URL) throws {
        guard let enumerator = fileManager.enumerator(at: root, includingPropertiesForKeys: nil) else {
            throw GuardianFailure.internalError("snapshot_enumeration_failed")
        }
        for case let url as URL in enumerator {
            let values = try url.resourceValues(forKeys: [.isRegularFileKey])
            if values.isRegularFile == true {
                let handle = try FileHandle(forReadingFrom: url)
                try handle.synchronize()
                try handle.close()
            }
        }
    }

    private func synchronizeDirectory(_ url: URL) throws {
        let descriptor = open(url.path, O_RDONLY | O_DIRECTORY)
        guard descriptor >= 0 else { throw GuardianFailure.internalError("directory_open_failed") }
        defer { close(descriptor) }
        guard fsync(descriptor) == 0 else {
            throw GuardianFailure.internalError("directory_fsync_failed")
        }
    }

    private func atomicExchange(_ first: URL, _ second: URL) throws {
        let result = first.path.withCString { firstPath in
            second.path.withCString { secondPath in
                renameatx_np(
                    AT_FDCWD,
                    firstPath,
                    AT_FDCWD,
                    secondPath,
                    UInt32(RENAME_SWAP)
                )
            }
        }
        guard result == 0 else {
            throw GuardianFailure.manual("atomic_exchange_unavailable")
        }
    }

    func isSafeIdentifier(_ value: String) -> Bool {
        !value.isEmpty && value.utf8.allSatisfy {
            ($0 >= 48 && $0 <= 57) || ($0 >= 65 && $0 <= 90)
                || ($0 >= 97 && $0 <= 122) || $0 == 45
        }
    }
}

enum GuardianFailure: Error {
    case notFound
    case invalid(String)
    case conflict(String)
    case idempotency(String)
    case precondition(String)
    case locked(String)
    case manual(String)
    case internalError(String)

    var ipc: GuardianIPCError {
        switch self {
        case .notFound: GuardianIPCError(code: "operation_not_found", message: "Operation not found")
        case let .invalid(message), let .precondition(message):
            GuardianIPCError(code: "precondition_failed", message: message)
        case let .conflict(message): GuardianIPCError(code: "operation_conflict", message: message)
        case let .idempotency(message): GuardianIPCError(code: "idempotency_conflict", message: message)
        case let .locked(message): GuardianIPCError(code: "update_locked", message: message)
        case let .manual(message): GuardianIPCError(code: "manual_update_required", message: message)
        case let .internalError(message): GuardianIPCError(code: "update_internal_error", message: message)
        }
    }
}
