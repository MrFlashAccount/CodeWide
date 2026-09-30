import Darwin
import SwiftUI

struct PairingConnectionPicker: View {
    @ObservedObject var runtime: RuntimeConnection
    @Binding var route: PairingRoute

    var body: some View {
        Menu {
            menuItems
        } label: {
            selectionLabel
        }
        .menuStyle(.button)
        .buttonStyle(.glass)
        .buttonBorderShape(.capsule)
        .controlSize(.large)
        .menuIndicator(.hidden)
        .tint(nil as Color?)
        .disabled(relayEndpoint == nil && directEndpoints.isEmpty)
        .accessibilityLabel("Connection")
        .accessibilityValue("\(selectedTitle), \(selectedScope), \(selectedAddress)")
        .help("Relay works from any network. Direct connections require the same network or VPN.")
        .onChange(of: relayEndpoint) {
            if relayEndpoint == nil, route == .relay {
                route = .direct
            }
        }
    }

    private var selectionLabel: some View {
        HStack(spacing: 11) {
            Image(systemName: selectedSymbol)
                .font(.system(size: 15, weight: .semibold))
                .frame(width: 20)
            Text(selectedTitle)
                .font(.body.weight(.semibold))
            Text("· \(selectedScope)")
                .font(.callout)
                .foregroundStyle(.secondary)
            Spacer(minLength: 12)
            Image(systemName: "chevron.up.chevron.down")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
        }
        .frame(width: 250, height: 36, alignment: .leading)
        .contentShape(Rectangle())
    }

    @ViewBuilder
    private var menuItems: some View {
        if let relayEndpoint {
            Button {
                route = .relay
            } label: {
                Label(
                    "Relay · \(Self.displayAddress(relayEndpoint))",
                    systemImage: route == .relay ? "checkmark" : "network"
                )
            }
        }
        ForEach(directEndpoints, id: \.self) { endpoint in
            directMenuItem(endpoint)
        }
    }

    private func directMenuItem(_ endpoint: String) -> some View {
        Button {
            runtime.pairingEndpoint = endpoint
            route = .direct
        } label: {
            Label(
                Self.directLabel(endpoint),
                systemImage: directMenuSymbol(for: endpoint)
            )
        }
    }

    private var directEndpoints: [String] {
        runtime.directAccess?.endpoints ?? []
    }

    private var selectedEndpoint: String? {
        guard route == .direct else { return nil }
        return runtime.pairingEndpoint ?? directEndpoints.first
    }

    private var selectedTitle: String {
        if route == .relay { return "Relay" }
        guard let selectedEndpoint else { return "Direct unavailable" }
        return Self.friendlyInterfaceName(Self.interfaceName(for: selectedEndpoint))
    }

    private var selectedAddress: String {
        if route == .relay {
            return relayEndpoint.map(Self.displayAddress) ?? "Not connected"
        }
        return selectedEndpoint.map(Self.displayAddress) ?? "No network address"
    }

    private var selectedScope: String {
        route == .relay ? "Any network" : "Same Wi-Fi or VPN"
    }

    private var selectedSymbol: String {
        if route == .relay { return "network" }
        return selectedEndpoint.map { Self.directSymbol($0) } ?? "wifi.exclamationmark"
    }

    private func directMenuSymbol(for endpoint: String) -> String {
        route == .direct && endpoint == selectedEndpoint
            ? "checkmark"
            : Self.directSymbol(endpoint)
    }

    private var relayEndpoint: String? {
        PairingRoute.relay.destination(
            endpoint: nil,
            availableEndpoints: [],
            relay: runtime.relay
        ).flatMap { destination in
            guard case .relay(let endpoint) = destination else { return nil }
            return endpoint
        }
    }

    static func directLabel(_ endpoint: String, interfaceName: String? = nil) -> String {
        let interface = interfaceName ?? Self.interfaceName(for: endpoint)
        return "\(friendlyInterfaceName(interface)) · \(displayAddress(endpoint))"
    }

    static func directSymbol(_ endpoint: String, interfaceName: String? = nil) -> String {
        let interface = interfaceName ?? Self.interfaceName(for: endpoint)
        guard let interface else { return "network" }
        if interface.hasPrefix("utun") || interface.hasPrefix("tun")
            || interface.hasPrefix("tap") || interface.hasPrefix("ppp")
            || interface.hasPrefix("ipsec") {
            return "lock.shield"
        }
        return interface == "en0" ? "wifi" : "network"
    }

    static func displayAddress(_ endpoint: String) -> String {
        guard let url = URL(string: endpoint), let host = url.host, let port = url.port else {
            return endpoint
        }
        return "\(host):\(port)"
    }

    static func friendlyInterfaceName(_ interface: String?) -> String {
        guard let interface else { return "Direct" }
        if interface.hasPrefix("utun") || interface.hasPrefix("tun")
            || interface.hasPrefix("tap") || interface.hasPrefix("ppp")
            || interface.hasPrefix("ipsec") {
            return "VPN"
        }
        if interface == "en0" { return "Wi-Fi" }
        if interface.hasPrefix("en") || interface.hasPrefix("eth") {
            return "Ethernet"
        }
        return "Direct"
    }

    private static func interfaceName(for endpoint: String) -> String? {
        guard let host = URL(string: endpoint)?.host else { return nil }
        var interfaces: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&interfaces) == 0, let first = interfaces else { return nil }
        defer { freeifaddrs(first) }

        var current: UnsafeMutablePointer<ifaddrs>? = first
        while let item = current {
            defer { current = item.pointee.ifa_next }
            guard let address = item.pointee.ifa_addr,
                  address.pointee.sa_family == UInt8(AF_INET) else { continue }

            var buffer = [CChar](repeating: 0, count: Int(NI_MAXHOST))
            let result = getnameinfo(
                address,
                socklen_t(address.pointee.sa_len),
                &buffer,
                socklen_t(buffer.count),
                nil,
                0,
                NI_NUMERICHOST
            )
            let addressText = buffer.withUnsafeBytes { bytes in
                String(decoding: bytes.prefix { $0 != 0 }, as: UTF8.self)
            }
            if result == 0, addressText == host {
                return String(cString: item.pointee.ifa_name)
            }
        }
        return nil
    }
}
