import Foundation
import ServiceManagement
@preconcurrency import Sparkle
import Testing
@testable import CodeWide

@Suite(.serialized, .timeLimit(.minutes(1)))
@MainActor
struct UpdateControllerTests {
    private func fixture() -> (UpdateController, SPUUpdater, UpdateTestAgent) {
        let agent = UpdateTestAgent()
        let runtime = RuntimeConnection(
            launchAgent: agent,
            proxyProvider: { _ in nil },
            reportsUpdateHealth: false,
            registration: nil
        )
        let updates = UpdateController(runtime: runtime, startingUpdater: false)
        // No scheduler, network requests or install UI is started. The real
        // Sparkle types exercise the production delegate's completion handling.
        let updater = SPUStandardUpdaterController(
            startingUpdater: false, updaterDelegate: nil, userDriverDelegate: nil
        ).updater
        return (updates, updater, agent)
    }

    @Test(arguments: [SUError.noUpdateError, .installationCanceledError, .installationAuthorizeLaterError])
    func normalOutcomesAreNotErrors(code: SUError) async {
        let (updates, updater, agent) = fixture()
        let outcome = NSError(
            domain: SUSparkleErrorDomain, code: Int(code.rawValue),
            userInfo: [NSLocalizedDescriptionKey: "A localized normal outcome"]
        )
        updates.updater(updater, didFinishUpdateCycleFor: .updateInformation, error: outcome)
        await Task.yield()
        #expect(updates.lastError == nil)
        #expect(!updates.isCheckingForUpdates)
        #expect(agent.statusReads == 0, "An ordinary update check must not resume the runtime")
    }

    @Test(arguments: [SUError.appcastError, .downloadError, .signatureError, .installationError])
    func actualFailuresRemainVisible(code: SUError) async {
        let (updates, updater, agent) = fixture()
        let failure = NSError(
            domain: SUSparkleErrorDomain, code: Int(code.rawValue),
            userInfo: [NSLocalizedDescriptionKey: "Update failed"]
        )
        updates.updater(updater, didFinishUpdateCycleFor: .updates, error: failure)
        await Task.yield()
        #expect(updates.lastError == "Update failed")
        #expect(agent.statusReads == 0, "Only a paused runtime needs recovery")
    }

    @Test func anotherDomainCannotMasqueradeAsNoUpdate() {
        let (updates, updater, _) = fixture()
        let failure = NSError(
            domain: "CodeWide.UpdateTests", code: Int(SUError.noUpdateError.rawValue),
            userInfo: [NSLocalizedDescriptionKey: "Unrelated failure"]
        )
        updates.updater(updater, didFinishUpdateCycleFor: .updateInformation, error: failure)
        #expect(updates.lastError == "Unrelated failure")
    }

    @Test func noUpdateAfterFailureClearsTheBanner() {
        let (updates, updater, _) = fixture()
        updates.updater(
            updater, didFinishUpdateCycleFor: .updateInformation,
            error: NSError(domain: NSURLErrorDomain, code: NSURLErrorTimedOut)
        )
        #expect(updates.lastError != nil)
        // Sparkle first calls the no-update delegate and then completes with
        // SUNoUpdateError. That second callback used to recreate the banner.
        updates.updaterDidNotFindUpdate(updater)
        updates.updater(
            updater, didFinishUpdateCycleFor: .updateInformation,
            error: NSError(domain: SUSparkleErrorDomain, code: Int(SUError.noUpdateError.rawValue),
                           userInfo: [NSLocalizedDescriptionKey: "You're up to date!"])
        )
        #expect(updates.availableVersion == nil)
        #expect(updates.lastError == nil)
    }

    @Test func successfulCycleClearsAPreviousFailure() {
        let (updates, updater, _) = fixture()
        updates.updater(
            updater, didFinishUpdateCycleFor: .updateInformation,
            error: NSError(domain: NSURLErrorDomain, code: NSURLErrorTimedOut)
        )
        #expect(updates.lastError != nil)
        updates.updater(updater, didFinishUpdateCycleFor: .updateInformation, error: nil)
        #expect(updates.lastError == nil)
        #expect(!updates.isCheckingForUpdates)
    }
}

@MainActor
private final class UpdateTestAgent: RuntimeAgentService {
    private(set) var statusReads = 0
    var status: SMAppService.Status {
        statusReads += 1
        return .requiresApproval
    }
    func register() throws { Issue.record("Update checks must not register a helper") }
    func unregister() async throws { Issue.record("Update checks must not unregister a helper") }
}
