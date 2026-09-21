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
    let decoded = try #require(
        NSKeyedUnarchiver.unarchivedObject(ofClass: RuntimeHealthPayload.self, from: data)
    )
    #expect(decoded.updateStatus == "applied")
    #expect(decoded.updateFromVersion == "1.0.0")
    #expect(decoded.launchCount == 3)
}
