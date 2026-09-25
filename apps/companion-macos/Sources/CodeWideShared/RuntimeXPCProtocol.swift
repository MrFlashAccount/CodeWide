import Foundation

@objc public protocol RuntimeXPCProtocol {
    func health(
        withReply reply: @escaping @Sendable (RuntimeHealthPayload?, NSError?) -> Void
    )

    func prepareForUpdate(
        targetVersion: String,
        withReply reply: @escaping @Sendable (RuntimeHealthPayload?, NSError?) -> Void
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

    func pairRelay(
        address: String,
        invitationJSON: String,
        withReply reply: @escaping @Sendable (RelayStatusPayload?, NSError?) -> Void
    )

    func setRelayEnabled(
        _ enabled: Bool,
        withReply reply: @escaping @Sendable (RelayStatusPayload?, NSError?) -> Void
    )

    func createPairing(
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
