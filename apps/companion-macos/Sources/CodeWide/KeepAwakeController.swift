import Combine
import Foundation
import IOKit.ps
import IOKit.pwr_mgt

enum KeepAwakePolicy: String, CaseIterable, Identifiable, Sendable {
    case always
    case whilePluggedIn
    case never

    var id: Self { self }

    var title: String {
        switch self {
        case .always: "Always"
        case .whilePluggedIn: "While Plugged In"
        case .never: "Never"
        }
    }

    func shouldPreventSleep(isPluggedIn: Bool) -> Bool {
        switch self {
        case .always: true
        case .whilePluggedIn: isPluggedIn
        case .never: false
        }
    }
}

@MainActor
protocol PowerSourceMonitoring: AnyObject {
    var isPluggedIn: Bool { get }
    func start(_ handler: @escaping @MainActor (Bool) -> Void)
    func stop()
}

@MainActor
protocol SleepAssertionControlling: AnyObject {
    var isActive: Bool { get }
    func setActive(_ active: Bool) throws
}

@MainActor
final class KeepAwakeController: ObservableObject {
    static let preferenceKey = "keepAwakePolicyV1"

    @Published private(set) var policy: KeepAwakePolicy
    @Published private(set) var isPluggedIn: Bool
    @Published private(set) var isKeepingAwake = false
    @Published private(set) var lastError: String?

    private let defaults: UserDefaults
    private let powerSource: any PowerSourceMonitoring
    private let assertion: any SleepAssertionControlling

    init(
        defaults: UserDefaults = .standard,
        powerSource: any PowerSourceMonitoring = IOKitPowerSourceMonitor(),
        assertion: any SleepAssertionControlling = IOKitSleepAssertion()
    ) {
        self.defaults = defaults
        self.powerSource = powerSource
        self.assertion = assertion
        policy = defaults.string(forKey: Self.preferenceKey)
            .flatMap(KeepAwakePolicy.init(rawValue:)) ?? .whilePluggedIn
        isPluggedIn = powerSource.isPluggedIn

        powerSource.start { [weak self] pluggedIn in
            self?.powerSourceChanged(pluggedIn)
        }
        applyPolicy()
    }

    func setPolicy(_ policy: KeepAwakePolicy) {
        guard self.policy != policy else { return }
        self.policy = policy
        defaults.set(policy.rawValue, forKey: Self.preferenceKey)
        applyPolicy()
    }

    func stop() {
        powerSource.stop()
        do {
            try assertion.setActive(false)
            isKeepingAwake = false
        } catch {
            lastError = error.localizedDescription
        }
    }

    var statusSummary: String {
        if isKeepingAwake { return "Preventing idle sleep" }
        if policy == .whilePluggedIn && !isPluggedIn { return "On battery · sleep allowed" }
        return "Idle sleep allowed"
    }

    private func powerSourceChanged(_ pluggedIn: Bool) {
        guard isPluggedIn != pluggedIn else { return }
        isPluggedIn = pluggedIn
        applyPolicy()
    }

    private func applyPolicy() {
        let shouldKeepAwake = policy.shouldPreventSleep(isPluggedIn: isPluggedIn)
        do {
            try assertion.setActive(shouldKeepAwake)
            isKeepingAwake = assertion.isActive
            lastError = nil
        } catch {
            isKeepingAwake = assertion.isActive
            lastError = error.localizedDescription
        }
    }
}

@MainActor
final class IOKitPowerSourceMonitor: PowerSourceMonitoring {
    private var notificationSource: CFRunLoopSource?
    private var handler: (@MainActor (Bool) -> Void)?

    var isPluggedIn: Bool { Self.readIsPluggedIn() }

    func start(_ handler: @escaping @MainActor (Bool) -> Void) {
        self.handler = handler
        guard notificationSource == nil,
              let unmanagedSource = IOPSCreateLimitedPowerNotification({ context in
                  guard let context else { return }
                  MainActor.assumeIsolated {
                      let monitor = Unmanaged<IOKitPowerSourceMonitor>
                          .fromOpaque(context)
                          .takeUnretainedValue()
                      monitor.handler?(monitor.isPluggedIn)
                  }
              }, Unmanaged.passUnretained(self).toOpaque())
        else { return }

        let source = unmanagedSource.takeRetainedValue()
        notificationSource = source
        CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
    }

    func stop() {
        if let notificationSource {
            CFRunLoopRemoveSource(CFRunLoopGetMain(), notificationSource, .commonModes)
        }
        notificationSource = nil
        handler = nil
    }

    private static func readIsPluggedIn() -> Bool {
        guard let unmanagedSnapshot = IOPSCopyPowerSourcesInfo() else { return true }
        let snapshot = unmanagedSnapshot.takeRetainedValue()
        guard let unmanagedType = IOPSGetProvidingPowerSourceType(snapshot) else { return true }
        let sourceType = unmanagedType.takeUnretainedValue() as String
        return sourceType == kIOPMACPowerKey
    }
}

private struct KeepAwakeAssertionError: LocalizedError {
    let operation: String
    let code: IOReturn

    var errorDescription: String? {
        "macOS couldn't \(operation) the Keep Awake mode (IOKit error \(code))."
    }
}

@MainActor
final class IOKitSleepAssertion: SleepAssertionControlling {
    private var assertionID = IOPMAssertionID(kIOPMNullAssertionID)

    var isActive: Bool { assertionID != kIOPMNullAssertionID }

    func setActive(_ active: Bool) throws {
        guard active != isActive else { return }
        if active {
            var newID = IOPMAssertionID(kIOPMNullAssertionID)
            let result = IOPMAssertionCreateWithName(
                kIOPMAssertionTypePreventUserIdleSystemSleep as CFString,
                IOPMAssertionLevel(kIOPMAssertionLevelOn),
                "CodeWide remote access" as CFString,
                &newID
            )
            guard result == kIOReturnSuccess else {
                throw KeepAwakeAssertionError(operation: "enable", code: result)
            }
            assertionID = newID
        } else {
            let currentID = assertionID
            let result = IOPMAssertionRelease(currentID)
            guard result == kIOReturnSuccess else {
                throw KeepAwakeAssertionError(operation: "disable", code: result)
            }
            assertionID = IOPMAssertionID(kIOPMNullAssertionID)
        }
    }

    deinit {
        if assertionID != kIOPMNullAssertionID {
            IOPMAssertionRelease(assertionID)
        }
    }
}
