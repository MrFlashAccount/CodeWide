import Foundation
import Testing
@testable import CodeWideShared

@Test func runtimeConstantsUseTheSelectedNamespaceConsistently() {
    #if CODEWIDE_E2E_NAMESPACE
    #expect(RuntimeConstants.appBundleIdentifier == "dev.codewide.app.e2e")
    #expect(RuntimeConstants.runtimeSigningIdentifier == "dev.codewide.runtime.e2e")
    #expect(RuntimeConstants.runtimeLaunchAgentLabel == "dev.codewide.runtime.e2e")
    #expect(RuntimeConstants.machServiceName == "dev.codewide.runtime.control.e2e")
    #expect(RuntimeConstants.launchAgentPlistName == "dev.codewide.runtime.e2e.plist")
    #expect(RuntimeConstants.guardianLaunchAgentLabel == "dev.codewide.update-guardian.e2e")
    #expect(
        RuntimeConstants.guardianLaunchAgentPlistName
            == "dev.codewide.update-guardian.e2e.plist"
    )
    #expect(RuntimeConstants.stateDirectory.path.hasSuffix("/CodeWideE2E/Companion"))
    #expect(RuntimeConstants.updaterDirectory.path.hasSuffix("/CodeWideE2E/Updater"))
    #expect(RuntimeConstants.companionListenAddress == "127.0.0.1:0")
    #else
    #expect(RuntimeConstants.appBundleIdentifier == "dev.codewide.app")
    #expect(RuntimeConstants.runtimeSigningIdentifier == "dev.codewide.runtime")
    #expect(RuntimeConstants.runtimeLaunchAgentLabel == "dev.codewide.runtime")
    #expect(RuntimeConstants.machServiceName == "dev.codewide.runtime.control")
    #expect(RuntimeConstants.launchAgentPlistName == "dev.codewide.runtime.plist")
    #expect(RuntimeConstants.guardianLaunchAgentLabel == "dev.codewide.update-guardian")
    #expect(RuntimeConstants.guardianLaunchAgentPlistName == "dev.codewide.update-guardian.plist")
    #expect(RuntimeConstants.stateDirectory.path.hasSuffix("/CodeWide/Companion"))
    #expect(RuntimeConstants.updaterDirectory.path.hasSuffix("/CodeWide/Updater"))
    #expect(RuntimeConstants.companionListenAddress == "0.0.0.0:8767")
    #endif
}

@Test func e2eManifestBaseAcceptsOnlyExplicitLoopbackHTTP() {
    #expect(
        RuntimeConstants.validatedE2EManifestBaseURL("http://127.0.0.1:18766/host")?
            .absoluteString == "http://127.0.0.1:18766/host"
    )
    #expect(RuntimeConstants.validatedE2EManifestBaseURL("https://127.0.0.1:18766") == nil)
    #expect(RuntimeConstants.validatedE2EManifestBaseURL("http://localhost:18766") == nil)
    #expect(RuntimeConstants.validatedE2EManifestBaseURL("http://127.0.0.1") == nil)
    #expect(RuntimeConstants.validatedE2EManifestBaseURL("http://example.com:18766") == nil)
}
