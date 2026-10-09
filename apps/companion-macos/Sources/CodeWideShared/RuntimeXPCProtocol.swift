import Foundation

@objc public protocol RuntimeXPCProtocol {
    func health(
        withReply reply: @escaping @Sendable (RuntimeHealthPayload?, NSError?) -> Void
    )

    func prepareForUpdate(
        targetVersion: String,
        withReply reply: @escaping @Sendable (RuntimeHealthPayload?, NSError?) -> Void
    )

    /// Stops the runtime for a guardian-owned transaction without creating a
    /// second pending/last-update authority in RuntimeHost state.
    func stopForGuardianUpdate(
        withReply reply: @escaping @Sendable (Bool, NSError?) -> Void
    )

    func appServer(
        withReply reply: @escaping @Sendable (AppServerPayload?, NSError?) -> Void
    )

    func discoverAppServers(
        withReply reply: @escaping @Sendable (AppServerListPayload?, NSError?) -> Void
    )

    func selectAppServer(
        id: String,
        withReply reply: @escaping @Sendable (AppServerPayload?, NSError?) -> Void
    )

    func startAppServer(
        id: String,
        withReply reply: @escaping @Sendable (AppServerPayload?, NSError?) -> Void
    )

    func relayStatus(
        withReply reply: @escaping @Sendable (RelayStatusPayload?, NSError?) -> Void
    )

    func relayUpdateStatus(
        withReply reply: @escaping @Sendable (String?, NSError?) -> Void
    )

    func checkRelayUpdate(
        withReply reply: @escaping @Sendable (String?, NSError?) -> Void
    )

    func applyRelayUpdate(
        targetFingerprint: String,
        idempotencyKey: String,
        withReply reply: @escaping @Sendable (String?, NSError?) -> Void
    )

    func pairRelay(
        address: String,
        invitationJSON: String,
        withReply reply: @escaping @Sendable (RelayStatusPayload?, NSError?) -> Void
    )

    func setRelayEnabled(
        _ enabled: Bool,
        withReply reply: @escaping @Sendable (RelayStatusPayload?, NSError?) -> Void
    )

    func beginRelayEnrollment(
        address: String,
        withReply reply: @escaping @Sendable (RelayEnrollmentPayload?, NSError?) -> Void
    )

    func relayEnrollmentStatus(
        id: String,
        withReply reply: @escaping @Sendable (RelayEnrollmentPayload?, NSError?) -> Void
    )

    func cancelRelayEnrollment(
        id: String,
        withReply reply: @escaping @Sendable (Bool, NSError?) -> Void
    )

    func directAccess(
        withReply reply: @escaping @Sendable (DirectAccessPayload?, NSError?) -> Void
    )

    func createPairing(
        directEndpoint: String?,
        withReply reply: @escaping @Sendable (PairingPayload?, NSError?) -> Void
    )

    func devices(
        withReply reply: @escaping @Sendable (DeviceListPayload?, NSError?) -> Void
    )

    func revokeDevice(
        id: String,
        withReply reply: @escaping @Sendable (Bool, NSError?) -> Void
    )
}

public func makeRuntimeXPCInterface() -> NSXPCInterface {
    NSXPCInterface(with: RuntimeXPCProtocol.self)
}
