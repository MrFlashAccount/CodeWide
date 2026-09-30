import CompanionSwiftFFI
import Foundation
import Testing

/// Uses the production Rust core with private temporary state, never the installed helper.
@Test func nativeCorePreservesStateAcrossAnUpdateAndRestart() throws {
    let root = FileManager.default.temporaryDirectory
        .appending(path: "codewide-native-test-\(UUID().uuidString)", directoryHint: .isDirectory)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: root) }
    let state = root.appending(path: "state", directoryHint: .isDirectory)
    let codex = root.appending(path: ".codex", directoryHint: .isDirectory)
    try FileManager.default.createDirectory(at: codex, withIntermediateDirectories: true)

    func open(_ version: String) throws -> CoreHost {
        try CoreHost(
            stateDirectory: state.path, codexHome: codex.path,
            appVersion: version, hostVersion: version, computerName: "Native test", listenAddress: "127.0.0.1:0"
        )
    }

    func prepare() throws -> UInt64 {
        let core = try open("98.0.0")
        return try withExtendedLifetime(core) {
            let health = try core.health()
            #expect(health.phase == "running")
            #expect(health.stateSchema == 1)
            #expect(core.appServerConnection() == .reconnecting(lastKnownVersion: nil))
            #expect(try core.relayStatus().configured == false)
            #expect(core.devices().isEmpty)
            #expect(try core.createPairing(directEndpoint: nil).link.hasPrefix("codewide://pair"))
            #expect(throws: (any Error).self) { try open("98.0.0") }
            let checkpoint = try core.prepareForUpdate(targetVersion: "98.0.1")
            #expect(checkpoint.updateStatus == "prepared")
            return health.launchCount
        }
    }

    let previousLaunchCount = try prepare()
    let sentinel = state.appending(path: "test-sentinel")
    try Data("keep".utf8).write(to: sentinel)
    let restarted = try open("98.0.1")
    try withExtendedLifetime(restarted) {
        let health = try restarted.health()
        #expect(health.phase == "running")
        #expect(health.launchCount == previousLaunchCount + 1)
        #expect(health.updateStatus == "applied")
        #expect(health.updateFromVersion == "98.0.0")
        #expect(health.updateTargetVersion == "98.0.1")
        #expect(try Data(contentsOf: sentinel) == Data("keep".utf8))
    }
}
