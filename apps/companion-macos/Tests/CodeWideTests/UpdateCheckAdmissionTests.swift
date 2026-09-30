import Foundation
import Testing
@testable import CodeWide

struct UpdateCheckAdmissionTests {
    @Test func installationTestsReserveTheSessionEvenWhenAProbeCouldStart() {
        var admission = UpdateCheckAdmission(mode: .installationTest)
        // Swift Testing captures method receivers by value. Mutate before the
        // assertion so its macro does not invoke a mutating method on that copy.
        let admitted = admission.admitInformationProbe(
            now: Date(), canCheckForUpdates: true, sessionInProgress: false
        )
        #expect(!admitted)
    }

    @Test func busyOrUnavailableSessionsDoNotConsumeTheHourlyProbe() {
        var admission = UpdateCheckAdmission(mode: .interactive)
        let now = Date()
        let busy = admission.admitInformationProbe(
            now: now, canCheckForUpdates: true, sessionInProgress: true
        )
        #expect(!busy)
        let unavailable = admission.admitInformationProbe(
            now: now, canCheckForUpdates: false, sessionInProgress: false
        )
        #expect(!unavailable)
        let firstProbe = admission.admitInformationProbe(
            now: now, canCheckForUpdates: true, sessionInProgress: false
        )
        #expect(firstProbe)
        let beforeDeadline = admission.admitInformationProbe(
            now: now.addingTimeInterval(3599), canCheckForUpdates: true, sessionInProgress: false
        )
        #expect(!beforeDeadline)
        let atDeadline = admission.admitInformationProbe(
            now: now.addingTimeInterval(3600), canCheckForUpdates: true, sessionInProgress: false
        )
        #expect(atDeadline)
    }
}
