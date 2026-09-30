import Foundation
import Testing
@testable import CodeWide

@Suite(.serialized)
@MainActor
struct KeepAwakeControllerTests {
    @Test func defaultPolicyTracksPowerTransitionsWithoutPolling() throws {
        let defaults = try makeDefaults()
        let power = TestPowerSource(isPluggedIn: true)
        let assertion = TestSleepAssertion()
        let controller = KeepAwakeController(
            defaults: defaults,
            powerSource: power,
            assertion: assertion
        )

        #expect(controller.policy == .whilePluggedIn)
        #expect(controller.isKeepingAwake)
        #expect(assertion.changes == [true])

        power.send(isPluggedIn: false)
        #expect(!controller.isKeepingAwake)
        #expect(assertion.changes == [true, false])

        power.send(isPluggedIn: true)
        #expect(controller.isKeepingAwake)
        #expect(assertion.changes == [true, false, true])
        controller.stop()
    }

    @Test func alwaysAndNeverIgnoreTheCurrentPowerSource() throws {
        let defaults = try makeDefaults()
        let power = TestPowerSource(isPluggedIn: false)
        let assertion = TestSleepAssertion()
        let controller = KeepAwakeController(
            defaults: defaults,
            powerSource: power,
            assertion: assertion
        )

        #expect(!controller.isKeepingAwake)
        controller.setPolicy(.always)
        #expect(controller.isKeepingAwake)
        power.send(isPluggedIn: true)
        power.send(isPluggedIn: false)
        #expect(controller.isKeepingAwake)

        controller.setPolicy(.never)
        #expect(!controller.isKeepingAwake)
        power.send(isPluggedIn: true)
        #expect(!controller.isKeepingAwake)
        controller.stop()
    }

    @Test func selectedPolicySurvivesARelaunch() throws {
        let defaults = try makeDefaults()
        let first = KeepAwakeController(
            defaults: defaults,
            powerSource: TestPowerSource(isPluggedIn: false),
            assertion: TestSleepAssertion()
        )
        first.setPolicy(.always)
        first.stop()

        let secondAssertion = TestSleepAssertion()
        let second = KeepAwakeController(
            defaults: defaults,
            powerSource: TestPowerSource(isPluggedIn: false),
            assertion: secondAssertion
        )
        #expect(second.policy == .always)
        #expect(second.isKeepingAwake)
        #expect(secondAssertion.changes == [true])
        second.stop()
    }

    private func makeDefaults() throws -> UserDefaults {
        let name = "KeepAwakeControllerTests.\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: name))
        defaults.removePersistentDomain(forName: name)
        return defaults
    }
}

@MainActor
private final class TestPowerSource: PowerSourceMonitoring {
    private(set) var isPluggedIn: Bool
    private var handler: (@MainActor (Bool) -> Void)?

    init(isPluggedIn: Bool) {
        self.isPluggedIn = isPluggedIn
    }

    func start(_ handler: @escaping @MainActor (Bool) -> Void) {
        self.handler = handler
    }

    func stop() {
        handler = nil
    }

    func send(isPluggedIn: Bool) {
        self.isPluggedIn = isPluggedIn
        handler?(isPluggedIn)
    }
}

@MainActor
private final class TestSleepAssertion: SleepAssertionControlling {
    private(set) var isActive = false
    private(set) var changes: [Bool] = []

    func setActive(_ active: Bool) throws {
        guard active != isActive else { return }
        isActive = active
        changes.append(active)
    }
}
