import Combine
import Foundation
import ServiceManagement

@MainActor
protocol LoginItemService: AnyObject {
    var status: SMAppService.Status { get }
    func register() throws
    func unregister() async throws
}

extension SMAppService: LoginItemService {}

@MainActor
final class LaunchAtLoginController: ObservableObject {
    static let defaultConfiguredKey = "didConfigureLaunchAtLoginV1"

    @Published private(set) var isEnabled = false
    @Published private(set) var requiresApproval = false
    @Published private(set) var isChanging = false
    @Published private(set) var lastError: String?

    private let defaults: UserDefaults
    private let service: any LoginItemService
    private let openSettings: @MainActor () -> Void

    init(
        defaults: UserDefaults = .standard,
        service: any LoginItemService = SMAppService.mainApp,
        openSettings: @escaping @MainActor () -> Void = {
            SMAppService.openSystemSettingsLoginItems()
        }
    ) {
        self.defaults = defaults
        self.service = service
        self.openSettings = openSettings
        applyDefaultIfNeeded()
        refreshStatus()
    }

    func refreshStatus() {
        let status = service.status
        isEnabled = status == .enabled
        requiresApproval = status == .requiresApproval
    }

    func setEnabled(_ enabled: Bool) async {
        guard !isChanging else { return }
        guard enabled != isEnabled || (enabled && requiresApproval) else { return }

        isChanging = true
        lastError = nil
        defer {
            refreshStatus()
            isChanging = false
        }

        do {
            if enabled {
                switch service.status {
                case .enabled:
                    break
                case .requiresApproval:
                    defaults.set(true, forKey: Self.defaultConfiguredKey)
                    openSettings()
                    return
                case .notRegistered, .notFound:
                    try service.register()
                @unknown default:
                    try service.register()
                }

                defaults.set(true, forKey: Self.defaultConfiguredKey)
                refreshStatus()
                if requiresApproval {
                    openSettings()
                } else if !isEnabled {
                    lastError = "macOS didn't enable Launch at Login. Try again."
                }
            } else {
                switch service.status {
                case .notRegistered, .notFound:
                    break
                case .enabled, .requiresApproval:
                    try await service.unregister()
                @unknown default:
                    try await service.unregister()
                }
                defaults.set(true, forKey: Self.defaultConfiguredKey)
            }
        } catch {
            refreshStatus()
            if isEnabled == enabled {
                defaults.set(true, forKey: Self.defaultConfiguredKey)
            } else if enabled && requiresApproval {
                defaults.set(true, forKey: Self.defaultConfiguredKey)
                openSettings()
            } else {
                lastError = error.localizedDescription
            }
        }
    }

    func openLoginItemsSettings() {
        openSettings()
    }

    private func applyDefaultIfNeeded() {
        guard !defaults.bool(forKey: Self.defaultConfiguredKey) else { return }

        do {
            switch service.status {
            case .enabled, .requiresApproval:
                break
            case .notRegistered, .notFound:
                try service.register()
            @unknown default:
                try service.register()
            }
            defaults.set(true, forKey: Self.defaultConfiguredKey)
        } catch {
            if service.status == .requiresApproval {
                defaults.set(true, forKey: Self.defaultConfiguredKey)
            } else {
                lastError = error.localizedDescription
            }
        }
    }
}
