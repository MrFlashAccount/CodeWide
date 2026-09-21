import CodeWideShared
import CompanionSwiftFFI
import Darwin
import Foundation

final class RuntimeService: NSObject, RuntimeXPCProtocol, @unchecked Sendable {
    private let core: CoreHost
    private let runtimeExecutablePath: String

    init(core: CoreHost, runtimeExecutablePath: String) {
        self.core = core
        self.runtimeExecutablePath = runtimeExecutablePath
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
}
