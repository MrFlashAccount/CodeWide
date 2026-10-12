import CodeWideShared
import Foundation
import Testing
@testable import CodeWideUpdateGuardian

@Test func guardianManifestURLsRespectTheBuildNamespace() throws {
    let environment = [
        RuntimeConstants.e2eManifestBaseEnvironmentName: "http://127.0.0.1:18766/host",
    ]
    #if CODEWIDE_E2E_NAMESPACE
    #expect(
        try GuardianManifestURLs.latest(environment: environment).absoluteString
            == "http://127.0.0.1:18766/host/latest/release-manifest.json"
    )
    #expect(
        try GuardianManifestURLs.baseline(tag: "v1.2.3", environment: environment)
            .absoluteString
            == "http://127.0.0.1:18766/host/releases/download/v1.2.3/release-manifest.json"
    )
    #expect(throws: (any Error).self) {
        try GuardianManifestURLs.latest(environment: [:])
    }
    #else
    #expect(
        try GuardianManifestURLs.latest(environment: environment).absoluteString
            == "https://github.com/MrFlashAccount/CodeWide/releases/latest/download/release-manifest.json"
    )
    #expect(
        try GuardianManifestURLs.baseline(tag: "v1.2.3", environment: environment)
            .absoluteString
            == "https://github.com/MrFlashAccount/CodeWide/releases/download/v1.2.3/release-manifest.json"
    )
    // Releases since 0.4.2 are tagged by date, not by version.
    #expect(
        try GuardianManifestURLs.baseline(tag: "release-2026-10-11.1", environment: environment)
            .absoluteString
            == "https://github.com/MrFlashAccount/CodeWide/releases/download/release-2026-10-11.1/release-manifest.json"
    )
    #endif
}
