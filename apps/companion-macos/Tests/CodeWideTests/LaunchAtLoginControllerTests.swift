import Foundation
import ServiceManagement
import Testing

@testable import CodeWide

@Suite(.serialized)
@MainActor
struct LaunchAtLoginControllerTests {
    @Test func firstLaunchEnablesLoginItemByDefault() throws {
        let defaults = try makeDefaults()
        let service = TestLoginItemService(status: .notRegistered)

        let controller = LaunchAtLoginController(defaults: defaults, service: service)

        #expect(service.registerCount == 1)
        #expect(controller.isEnabled)
        #expect(defaults.bool(forKey: LaunchAtLoginController.defaultConfiguredKey))
    }

    @Test func explicitDisableSurvivesControllerRecreation() async throws {
        let defaults = try makeDefaults()
        let service = TestLoginItemService(status: .notRegistered)
        let first = LaunchAtLoginController(defaults: defaults, service: service)
        #expect(first.isEnabled)

        await first.setEnabled(false)
        #expect(!first.isEnabled)
        #expect(service.unregisterCount == 1)

        _ = LaunchAtLoginController(defaults: defaults, service: service)
        #expect(service.registerCount == 1)
        #expect(service.status == .notRegistered)
    }

    @Test func enablingAnItemThatNeedsApprovalOpensSystemSettings() async throws {
        let defaults = try makeDefaults()
        defaults.set(true, forKey: LaunchAtLoginController.defaultConfiguredKey)
        let service = TestLoginItemService(status: .requiresApproval)
        var settingsOpenCount = 0
        let controller = LaunchAtLoginController(
            defaults: defaults,
            service: service,
            openSettings: { settingsOpenCount += 1 }
        )

        #expect(controller.requiresApproval)
        await controller.setEnabled(true)

        #expect(settingsOpenCount == 1)
        #expect(service.registerCount == 0)
        #expect(!controller.isEnabled)
    }

    @Test func registrationFailureIsVisibleAndRetriedNextLaunch() throws {
        let defaults = try makeDefaults()
        let service = TestLoginItemService(status: .notRegistered)
        service.registrationError = TestLoginItemError.registrationFailed

        let controller = LaunchAtLoginController(defaults: defaults, service: service)

        #expect(controller.lastError == "Registration failed")
        #expect(!defaults.bool(forKey: LaunchAtLoginController.defaultConfiguredKey))
        #expect(service.registerCount == 1)
    }

    private func makeDefaults() throws -> UserDefaults {
        let name = "LaunchAtLoginControllerTests.\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: name))
        defaults.removePersistentDomain(forName: name)
        return defaults
    }
}

@MainActor
private final class TestLoginItemService: LoginItemService {
    private(set) var status: SMAppService.Status
    var registrationError: Error?
    private(set) var registerCount = 0
    private(set) var unregisterCount = 0

    init(status: SMAppService.Status) {
        self.status = status
    }

    func register() throws {
        registerCount += 1
        if let registrationError { throw registrationError }
        status = .enabled
    }

    func unregister() async throws {
        unregisterCount += 1
        status = .notRegistered
    }
}

private enum TestLoginItemError: LocalizedError {
    case registrationFailed

    var errorDescription: String? { "Registration failed" }
}
