import Foundation
import Testing
@testable import CodeWideUpdateGuardian

@Suite("Update guardian durable storage")
struct GuardianStorageTests {
    @Test func directoriesAndDurableFilesArePrivate() throws {
        let root = try temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let storage = try GuardianStorage(root: root)
        try storage.saveState(GuardianStoredState())

        for url in [root, root.appending(path: "v1"), storage.operationsDirectory] {
            #expect(try permissions(url) & 0o077 == 0)
        }
        #expect(try permissions(storage.stateURL) & 0o077 == 0)
    }

    @Test func reversibleRenameProbeLeavesCanonicalBundleUntouched() throws {
        let root = try temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let storage = try GuardianStorage(root: root.appending(path: "updater"))
        let app = root.appending(path: "CodeWide.app", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: app, withIntermediateDirectories: true)
        let sentinel = app.appending(path: "sentinel")
        try Data("original".utf8).write(to: sentinel)

        try storage.probeAtomicSiblingRename(canonicalApp: app)

        #expect(try String(contentsOf: sentinel, encoding: .utf8) == "original")
        let leftovers = try FileManager.default.contentsOfDirectory(atPath: root.path)
            .filter { $0.hasPrefix(".codewide-update-probe-") }
        #expect(leftovers.isEmpty)
    }

    @Test func snapshotAndAtomicRestoreOperateOnDisposableSiblingBundle() throws {
        let root = try temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let storage = try GuardianStorage(root: root.appending(path: "updater"))
        let app = root.appending(path: "CodeWide.app", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: app, withIntermediateDirectories: true)
        let payload = app.appending(path: "payload")
        try Data("previous".utf8).write(to: payload)
        let expected = try storage.bundleTreeDigest(app)

        let snapshot = try storage.createSnapshot(canonicalApp: app, operationID: "operation-1")
        try Data("bad-target".utf8).write(to: payload)
        try storage.restoreSnapshot(
            snapshot: snapshot,
            canonicalApp: app
        )

        #expect(try storage.bundleTreeDigest(app) == expected)
        #expect(try String(contentsOf: payload, encoding: .utf8) == "previous")
        #expect(FileManager.default.fileExists(atPath: snapshot.path))
        try storage.discardSnapshot(snapshot)
        #expect(!FileManager.default.fileExists(atPath: snapshot.path))
    }

    @Test func snapshotRetryAcceptsOnlyTheSameSourceBytes() throws {
        let root = try temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let storage = try GuardianStorage(root: root.appending(path: "updater"))
        let app = root.appending(path: "CodeWide.app", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: app, withIntermediateDirectories: true)
        let payload = app.appending(path: "payload")
        try Data("previous".utf8).write(to: payload)
        let first = try storage.createSnapshot(canonicalApp: app, operationID: "operation-2")
        let retry = try storage.createSnapshot(canonicalApp: app, operationID: "operation-2")
        #expect(first == retry)

        try Data("changed".utf8).write(to: payload)
        #expect(throws: (any Error).self) {
            _ = try storage.createSnapshot(canonicalApp: app, operationID: "operation-2")
        }
    }

    @Test func restoreRejectsANonSiblingSnapshotBeforeMovingTheCanonicalApp() throws {
        let root = try temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let storage = try GuardianStorage(root: root.appending(path: "updater"))
        let app = root.appending(path: "CodeWide.app", directoryHint: .isDirectory)
        let elsewhere = root.appending(path: "elsewhere", directoryHint: .isDirectory)
        let snapshot = elsewhere.appending(path: "snapshot.app", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: app, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: snapshot, withIntermediateDirectories: true)
        let sentinel = app.appending(path: "sentinel")
        try Data("preserved".utf8).write(to: sentinel)

        #expect(throws: (any Error).self) {
            try storage.restoreSnapshot(snapshot: snapshot, canonicalApp: app)
        }
        #expect(try String(contentsOf: sentinel, encoding: .utf8) == "preserved")
    }

    @Test func deviceIdentityDigestAllowsReconnectChurnButRejectsCredentialChanges() throws {
        let root = try temporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let storage = try GuardianStorage(root: root.appending(path: "updater"))
        let registry = root.appending(path: "devices.json")
        try Data(#"{"version":5,"devices":[{"id":"b","name":"B","tokenHash":"tb","createdAt":2,"lastSeenAt":2},{"id":"a","name":"A","tokenHash":"ta","createdAt":1,"lastSeenAt":1}],"pairings":[{"tokenHash":"pending","expiresAt":9}]}"#.utf8)
            .write(to: registry)
        let baseline = try storage.deviceRegistryIdentityDigest(registry)

        try Data(#"{"version":5,"devices":[{"id":"a","name":"A","tokenHash":"ta","createdAt":1,"lastSeenAt":100},{"id":"b","name":"B","tokenHash":"tb","createdAt":2,"lastSeenAt":200}],"pairings":[]}"#.utf8)
            .write(to: registry)
        #expect(try storage.deviceRegistryIdentityDigest(registry) == baseline)

        try Data(#"{"version":5,"devices":[{"id":"a","name":"A","tokenHash":"changed","createdAt":1,"lastSeenAt":100},{"id":"b","name":"B","tokenHash":"tb","createdAt":2,"lastSeenAt":200}],"pairings":[]}"#.utf8)
            .write(to: registry)
        #expect(try storage.deviceRegistryIdentityDigest(registry) != baseline)
    }

    private func temporaryRoot() throws -> URL {
        let root = FileManager.default.temporaryDirectory
            .appending(path: "codewide-guardian-tests-\(UUID().uuidString)", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        return root
    }

    private func permissions(_ url: URL) throws -> Int {
        let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
        return (attributes[.posixPermissions] as? NSNumber)?.intValue ?? 0
    }
}
