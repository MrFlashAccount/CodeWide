import CodeWideShared
import Testing
@testable import CodeWide

@Suite("Remote Sparkle exact-target admission")
struct RemoteSparkleAdmissionTests {
    private let command = RemoteUpdateCommand(
        operationId: "upd_00000000000000000000000000000000",
        nonce: "fence_00000000000000000000000000000000",
        targetVersion: "2.4.0",
        targetBuild: "20400"
    )

    @Test func acceptsOnlyTheExactSignedTarget() {
        #expect(RemoteSparkleAdmission.accepts(
            displayVersion: "2.4.0",
            build: "20400",
            signatureValidated: true,
            command: command
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
            command: command
        ))
    }
}
