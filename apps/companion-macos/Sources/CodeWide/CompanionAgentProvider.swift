import Foundation

/// The validated local connection state of one agent provider. It is decoded
/// from the same credential-free snapshot that the Companion serves to clients.
struct CompanionAgentProvider: Decodable, Equatable, Identifiable {
    enum RuntimeStatus: String, Decodable {
        case disabled
        case live
        case reconnecting
        case unavailable
    }

    let id: String
    let name: String
    let primary: Bool
    let status: RuntimeStatus
    let version: String?

    private enum CodingKeys: String, CodingKey {
        case id
        case name
        case primary
        case status
        case version
    }

    init(from decoder: any Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = try Self.boundedText(values.decode(String.self, forKey: .id), maximum: 64)
        name = try Self.boundedText(values.decode(String.self, forKey: .name), maximum: 64)
        primary = try values.decode(Bool.self, forKey: .primary)
        status = try values.decode(RuntimeStatus.self, forKey: .status)
        if let decodedVersion = try values.decodeIfPresent(String.self, forKey: .version) {
            version = try Self.boundedText(decodedVersion, maximum: 128)
        } else {
            version = nil
        }
    }

    var isEnabled: Bool {
        status != .disabled
    }

    var connectionSummary: String {
        switch status {
        case .disabled: "Disabled"
        case .live: "Connected"
        case .reconnecting: "Reconnecting"
        case .unavailable: "Not connected"
        }
    }

    static func decodeList(_ json: String) throws -> [CompanionAgentProvider] {
        struct Envelope: Decodable {
            let providers: [CompanionAgentProvider]
        }
        let data = Data(json.utf8)
        let envelope = try JSONDecoder().decode(Envelope.self, from: data)
        guard envelope.providers.count <= 32 else {
            throw DecodingError.dataCorrupted(
                .init(codingPath: [], debugDescription: "Too many agent providers")
            )
        }
        return envelope.providers
    }

    private static func boundedText(_ value: String, maximum: Int) throws -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed.count <= maximum else {
            throw DecodingError.dataCorrupted(
                .init(codingPath: [], debugDescription: "Provider text is invalid")
            )
        }
        return trimmed
    }
}
