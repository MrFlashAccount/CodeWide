import Foundation
import Testing
@testable import CodeWideShared

@Test func healthPayloadSecureCodingRoundTrip() throws {
    let original = RuntimeHealthPayload(
        phase: "running",
        degradedReason: nil,
        appVersion: "1.1.0",
        hostVersion: "1.1.0",
        coreVersion: "1.1.0",
        stateSchema: 1,
        processID: 42,
        launchCount: 3,
        startedAtUnixMilliseconds: 100,
        updateStatus: "applied",
        updateFromVersion: "1.0.0",
        updateTargetVersion: "1.1.0",
        updateFailureReason: nil,
        hostExecutablePath: "/Applications/CodeWide.app/Contents/MacOS/CodeWideRuntime"
    )
    let data = try NSKeyedArchiver.archivedData(
        withRootObject: original,
        requiringSecureCoding: true
    )
    let unarchived = try NSKeyedUnarchiver.unarchivedObject(
        ofClass: RuntimeHealthPayload.self,
        from: data
    )
    let decoded = try #require(unarchived)
    #expect(decoded.updateStatus == "applied")
    #expect(decoded.updateFromVersion == "1.0.0")
    #expect(decoded.launchCount == 3)
}

@Test func managementPayloadsSecureCodingRoundTrip() throws {
    let original = DeviceListPayload(devices: [
        DeviceStatusPayload(
            id: "device-1",
            name: "Phone",
            createdAtUnixMilliseconds: 10,
            lastSeenAtUnixMilliseconds: 20,
            activeConnections: 2
        ),
    ])
    let data = try NSKeyedArchiver.archivedData(
        withRootObject: original,
        requiringSecureCoding: true
    )
    let unarchived = try NSKeyedUnarchiver.unarchivedObject(
        ofClass: DeviceListPayload.self,
        from: data
    )
    let decoded = try #require(unarchived)
    #expect(decoded.devices.count == 1)
    #expect(decoded.devices[0].name == "Phone")
    #expect(decoded.devices[0].activeConnections == 2)
}

@Test func appServerPayloadsPreserveAvailabilityAndSelection() throws {
    let original = AppServerListPayload(
        servers: [
            AppServerPayload(
                id: "default",
                displayName: "Default",
                codexHome: "/Users/test/.codex",
                state: .available(version: "0.156.1"),
                selected: true
            ),
            AppServerPayload(
                id: "work",
                displayName: "work",
                codexHome: "/Users/test/.codex-work",
                state: .unavailable(lastKnownVersion: "0.155.0"),
                selected: false
            ),
        ],
        codexInstallation: CodexInstallationPayload(
            state: .ready(installedVersion: "0.157.0")
        )
    )
    let data = try NSKeyedArchiver.archivedData(
        withRootObject: original,
        requiringSecureCoding: true
    )
    let unarchived = try NSKeyedUnarchiver.unarchivedObject(
        ofClass: AppServerListPayload.self,
        from: data
    )
    let decoded = try #require(unarchived)
    #expect(decoded.servers.count == 2)
    #expect(decoded.servers[0].selected)
    #expect(decoded.servers[0].state == .available(version: "0.156.1"))
    #expect(decoded.servers[1].state == .unavailable(lastKnownVersion: "0.155.0"))
    #expect(decoded.codexInstallation.state == .ready(installedVersion: "0.157.0"))
}

@Test func codexInstallationPayloadPreservesUpdateRequirement() throws {
    let original = CodexInstallationPayload(
        state: .updateRequired(
            installedVersion: "0.154.0",
            minimumVersion: "0.155.1"
        )
    )
    let data = try NSKeyedArchiver.archivedData(
        withRootObject: original,
        requiringSecureCoding: true
    )
    let unarchived = try NSKeyedUnarchiver.unarchivedObject(
        ofClass: CodexInstallationPayload.self,
        from: data
    )
    let decoded = try #require(unarchived)

    #expect(
        decoded.state == .updateRequired(
            installedVersion: "0.154.0",
            minimumVersion: "0.155.1"
        )
    )
}
