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
