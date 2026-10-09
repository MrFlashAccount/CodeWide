import CodeWideShared
import Testing
@testable import CodeWide

@Suite("Remote Sparkle exact-target admission")
struct RemoteSparkleAdmissionTests {
    private let target = ReleaseTargetPayload(
        platform: "macos-universal",
        version: "2.4.0",
        build: "20400",
        sourceRevision: String(repeating: "a", count: 40),
        artifactUrl: "https://example.invalid/CodeWide.dmg",
        sha256: String(repeating: "b", count: 64),
        bootstrapVersion: 1,
        journalVersion: 1,
        stateEpoch: 1,
        rollbackCompatibleFrom: [String(repeating: "c", count: 64)]
    )

    @Test func acceptsOnlyTheExactSignedTarget() {
        #expect(RemoteSparkleAdmission.accepts(
            displayVersion: "2.4.0",
            build: "20400",
            signatureValidated: true,
            target: target
        ))
    }

    @Test(arguments: [
        ("2.4.1", "20400", true),
        ("2.4.0", "20401", true),
        ("2.4.0", "20400", false),
    ])
    func rejectsWrongOrUnsignedTargets(candidate: (String, String, Bool)) {
        #expect(!RemoteSparkleAdmission.accepts(
            displayVersion: candidate.0,
            build: candidate.1,
            signatureValidated: candidate.2,
            target: target
        ))
    }
}
