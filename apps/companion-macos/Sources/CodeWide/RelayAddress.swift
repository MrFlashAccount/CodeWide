import Foundation

enum RelayAddress {
    static func normalized(_ input: String) throws -> String {
        let address = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !address.contains(where: { $0.isWhitespace || "/?#@".contains($0) }),
              let portText = address.split(separator: ":", omittingEmptySubsequences: false).last,
              let port = UInt16(portText), port > 0,
              let components = URLComponents(string: "wss://\(address)"),
              components.url != nil,
              let host = components.host, !host.isEmpty,
              components.port == Int(port),
              components.user == nil, components.password == nil,
              components.path.isEmpty,
              components.query == nil, components.fragment == nil else {
            throw InvalidRelayAddress()
        }
        return address
    }
}

private struct InvalidRelayAddress: LocalizedError {
    var errorDescription: String? {
        "Enter the Relay's DNS name or IP address and port, for example relay.example.com:8780. SSH aliases are not expanded."
    }
}
