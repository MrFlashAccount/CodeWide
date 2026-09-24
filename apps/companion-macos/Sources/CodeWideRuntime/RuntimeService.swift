import CodeWideShared
import CompanionSwiftFFI
import Darwin
import Foundation

final class RuntimeService: NSObject, RuntimeXPCProtocol, @unchecked Sendable {
    private let core: CoreHost
    private let runtimeExecutablePath: String
    private let selectionStore: AppServerSelectionStore
    private let selectedCodexHome: URL
    private let userHome: URL

    init(
        core: CoreHost,
        runtimeExecutablePath: String,
        selectionStore: AppServerSelectionStore,
        selectedCodexHome: URL,
        userHome: URL
    ) {
        self.core = core
        self.runtimeExecutablePath = runtimeExecutablePath
        self.selectionStore = selectionStore
        self.selectedCodexHome = selectedCodexHome
        self.userHome = userHome
    }

    func health(
        withReply reply: @escaping @Sendable (RuntimeHealthPayload?, NSError?) -> Void
    ) {
        do {
            reply(try payload(from: core.health()), nil)
        } catch {
            reply(nil, error as NSError)
        }
    }

    func prepareForUpdate(
        targetVersion: String,
        withReply reply: @escaping @Sendable (RuntimeHealthPayload?, NSError?) -> Void
    ) {
        do {
            let health = try core.prepareForUpdate(targetVersion: targetVersion)
            reply(payload(from: health), nil)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
                exit(EXIT_SUCCESS)
            }
        } catch {
            reply(nil, error as NSError)
        }
    }

    func appServer(
        withReply reply: @escaping @Sendable (AppServerPayload?, NSError?) -> Void
    ) {
        reply(currentAppServerPayload(), nil)
    }

    func discoverAppServers(
        withReply reply: @escaping @Sendable (AppServerListPayload?, NSError?) -> Void
    ) {
        do {
            let candidates = try core.discoverAppServers(homeDirectory: userHome.path)
            reply(
                AppServerListPayload(servers: candidates.map { appServerPayload(from: $0) }),
                nil
            )
        } catch {
            reply(nil, error as NSError)
        }
    }

    func selectAppServer(
        id: String,
        withReply reply: @escaping @Sendable (AppServerPayload?, NSError?) -> Void
    ) {
        do {
            let candidates = try core.discoverAppServers(homeDirectory: userHome.path)
            guard let candidate = candidates.first(where: { $0.id == id }) else {
                throw RuntimeServiceError.appServerNotFound
            }
            guard case .available = candidate.availability else {
                throw RuntimeServiceError.appServerUnavailable
            }
            try selectionStore.save(codexHome: candidate.codexHome)
            reply(appServerPayload(from: candidate, selected: true), nil)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
                // The LaunchAgent restarts unsuccessful exits. A successful
                // exit is reserved for Sparkle's deliberate update shutdown.
                exit(EXIT_FAILURE)
            }
        } catch {
            reply(nil, error as NSError)
        }
    }

    func relayStatus(
        withReply reply: @escaping @Sendable (RelayStatusPayload?, NSError?) -> Void
    ) {
        do {
            reply(relayPayload(from: try core.relayStatus()), nil)
        } catch {
            reply(nil, error as NSError)
        }
    }

    func pairRelay(
        address: String,
        invitationJSON: String,
        withReply reply: @escaping @Sendable (RelayStatusPayload?, NSError?) -> Void
    ) {
        do {
            let status = try core.pairRelay(
                relayAddress: address,
                invitationJson: invitationJSON
            )
            reply(relayPayload(from: status), nil)
        } catch {
            reply(nil, error as NSError)
        }
    }

    func setRelayEnabled(
        _ enabled: Bool,
        withReply reply: @escaping @Sendable (RelayStatusPayload?, NSError?) -> Void
    ) {
        do {
            reply(relayPayload(from: try core.setRelayEnabled(enabled: enabled)), nil)
        } catch {
            reply(nil, error as NSError)
        }
    }

    func createPairing(
        withReply reply: @escaping @Sendable (PairingPayload?, NSError?) -> Void
    ) {
        do {
            let pairing = try core.createPairing()
            reply(
                PairingPayload(
                    link: pairing.link,
                    expiresAtUnixMilliseconds: pairing.expiresAtUnixMs
                ),
                nil
            )
        } catch {
            reply(nil, error as NSError)
        }
    }

    func devices(
        withReply reply: @escaping @Sendable (DeviceListPayload?, NSError?) -> Void
    ) {
        let devices = core.devices().map { device in
            DeviceStatusPayload(
                id: device.id,
                name: device.name,
                createdAtUnixMilliseconds: device.createdAtUnixMs,
                lastSeenAtUnixMilliseconds: device.lastSeenAtUnixMs,
                activeConnections: device.activeConnections
            )
        }
        reply(DeviceListPayload(devices: devices), nil)
    }

    func revokeDevice(
        id: String,
        withReply reply: @escaping @Sendable (Bool, NSError?) -> Void
    ) {
        do {
            reply(try core.revokeDevice(deviceId: id), nil)
        } catch {
            reply(false, error as NSError)
        }
    }

    private func payload(from health: FfiRuntimeHealth) -> RuntimeHealthPayload {
        RuntimeHealthPayload(
            phase: health.phase,
            degradedReason: health.degradedReason,
            appVersion: health.appVersion,
            hostVersion: health.hostVersion,
            coreVersion: health.coreVersion,
            stateSchema: health.stateSchema,
            processID: Int32(bitPattern: health.processId),
            launchCount: health.launchCount,
            startedAtUnixMilliseconds: health.startedAtUnixMs,
            updateStatus: health.updateStatus,
            updateFromVersion: health.updateFromVersion,
            updateTargetVersion: health.updateTargetVersion,
            updateFailureReason: health.updateFailureReason,
            hostExecutablePath: runtimeExecutablePath
        )
    }

    private func relayPayload(from status: FfiRelayStatus) -> RelayStatusPayload {
        RelayStatusPayload(
            configured: status.configured,
            enabled: status.enabled,
            connection: status.connection,
            publicEndpoint: status.publicEndpoint
        )
    }

    private func currentAppServerPayload() -> AppServerPayload {
        let state: AppServerState = switch core.appServerConnection() {
        case let .live(version):
            .available(version: version)
        case let .reconnecting(lastKnownVersion):
            .unavailable(lastKnownVersion: lastKnownVersion)
        }
        return AppServerPayload(
            id: selectedCodexHome.path,
            displayName: displayName(for: selectedCodexHome),
            codexHome: selectedCodexHome.path,
            state: state,
            selected: true
        )
    }

    private func appServerPayload(
        from candidate: FfiAppServerCandidate,
        selected: Bool? = nil
    ) -> AppServerPayload {
        let state: AppServerState = switch candidate.availability {
        case let .available(version):
            .available(version: version)
        case .unavailable:
            .unavailable(lastKnownVersion: nil)
        }
        return AppServerPayload(
            id: candidate.id,
            displayName: candidate.displayName,
            codexHome: candidate.codexHome,
            state: state,
            selected: selected ?? candidate.selected
        )
    }

    private func displayName(for codexHome: URL) -> String {
        codexHome.lastPathComponent == ".codex"
            ? "Default"
            : String(codexHome.lastPathComponent.dropFirst(".codex-".count))
    }
}

private enum RuntimeServiceError: LocalizedError {
    case appServerNotFound
    case appServerUnavailable

    var errorDescription: String? {
        switch self {
        case .appServerNotFound:
            "The selected Codex App Server is no longer available."
        case .appServerUnavailable:
            "The selected Codex App Server did not answer its initialize handshake."
        }
    }
}
