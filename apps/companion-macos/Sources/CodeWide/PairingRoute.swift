import CodeWideShared
import Foundation

enum PairingRoute: String, CaseIterable, Identifiable {
    case direct, relay
    var id: String { rawValue }
    var title: String { self == .direct ? "Direct" : "Relay" }
    var symbol: String { self == .direct ? "wifi" : "network" }

    func destination(endpoint: String?, availableEndpoints: [String],
                     relay: RelayStatusPayload?) -> PairingDestination? {
        switch self {
        case .direct:
            guard let endpoint, availableEndpoints.contains(endpoint) else { return nil }
            return .direct(endpoint)
        case .relay:
            guard let relay, relay.configured, relay.enabled, relay.connection == "online",
                  let endpoint = relay.publicEndpoint,
                  let url = URL(string: endpoint), url.scheme == "wss", url.host != nil else { return nil }
            return .relay(endpoint)
        }
    }
}

enum PairingDestination: Equatable {
    case direct(String), relay(String)

    var key: String {
        switch self {
        case .direct(let endpoint): "direct:\(endpoint)"
        case .relay(let endpoint): "relay:\(endpoint)"
        }
    }

    /// A nil direct endpoint explicitly asks the core to create a Relay link.
    var directEndpoint: String? {
        switch self {
        case .direct(let endpoint): endpoint
        case .relay: nil
        }
    }
}
