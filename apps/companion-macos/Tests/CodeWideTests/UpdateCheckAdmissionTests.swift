import Foundation
import Testing
@testable import CodeWide

struct UpdateCheckAdmissionTests {
    @Test func installationTestsReserveTheSessionEvenWhenAProbeCouldStart() {
        var admission = UpdateCheckAdmission(mode: .installationTest)
        #expect(!admission.admitInformationProbe(
            now: Date(), canCheckForUpdates: true, sessionInProgress: false
        ))
    }

    @Test func busyOrUnavailableSessionsDoNotConsumeTheHourlyProbe() {
        var admission = UpdateCheckAdmission(mode: .interactive)
        let now = Date()
        #expect(!admission.admitInformationProbe(
            now: now, canCheckForUpdates: true, sessionInProgress: true
        ))
        #expect(!admission.admitInformationProbe(
            now: now, canCheckForUpdates: false, sessionInProgress: false
        ))
        #expect(admission.admitInformationProbe(
            now: now, canCheckForUpdates: true, sessionInProgress: false
        ))
        #expect(!admission.admitInformationProbe(
            now: now.addingTimeInterval(3599), canCheckForUpdates: true, sessionInProgress: false
        ))
        #expect(admission.admitInformationProbe(
            now: now.addingTimeInterval(3600), canCheckForUpdates: true, sessionInProgress: false
        ))
    }
}
