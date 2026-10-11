import Foundation

/// The validated local presentation of one agent provider. It is decoded from
/// the same credential-free snapshot that the Companion serves to mobile clients.
struct CompanionAgentProvider: Decodable, Equatable, Identifiable {
    enum Authentication: String, Decodable {
        case authenticated
        case unauthenticated
        case unknown
    }

    enum RuntimeStatus: String, Decodable {
        case disabled
        case live
        case reconnecting
        case unavailable
    }

    enum LimitStatus: String, Decodable {
        case allowed
        case rejected
        case warning
    }

    enum LimitKind: String, Decodable {
        case other
        case session
        case weekly
    }

    struct LimitWindow: Decodable, Equatable, Identifiable {
        let id: String
        let kind: LimitKind
        let label: String
        let resetsAt: UInt64?
        let status: LimitStatus?
        let usedPercent: Double?
        let windowDurationMinutes: UInt64?

        private enum CodingKeys: String, CodingKey {
            case id
            case kind
            case label
            case resetsAt
            case status
            case usedPercent
            case windowDurationMinutes = "windowDurationMins"
        }

        init(from decoder: any Decoder) throws {
            let values = try decoder.container(keyedBy: CodingKeys.self)
            id = try Self.boundedText(values.decode(String.self, forKey: .id), maximum: 64)
            kind = try values.decode(LimitKind.self, forKey: .kind)
            label = try Self.boundedText(
                values.decode(String.self, forKey: .label),
                maximum: 64
            )
            resetsAt = try Self.positiveInteger(values.decodeIfPresent(UInt64.self, forKey: .resetsAt))
            status = try values.decodeIfPresent(LimitStatus.self, forKey: .status)
            let percent = try values.decodeIfPresent(Double.self, forKey: .usedPercent)
            if let percent {
                guard percent.isFinite, (0 ... 100).contains(percent) else {
                    throw DecodingError.dataCorruptedError(
                        forKey: .usedPercent,
                        in: values,
                        debugDescription: "Provider usage must be between 0 and 100"
                    )
                }
            }
            usedPercent = percent
            windowDurationMinutes = try Self.positiveInteger(
                values.decodeIfPresent(UInt64.self, forKey: .windowDurationMinutes)
            )
        }

        var remainingPercent: Int? {
            if let usedPercent {
                return Int((100 - usedPercent).rounded())
            }
            return status == .rejected ? 0 : nil
        }

        private static func positiveInteger(_ value: UInt64?) throws -> UInt64? {
            guard value != 0 else {
                throw DecodingError.dataCorrupted(
                    .init(codingPath: [], debugDescription: "Provider limit values must be positive")
                )
            }
            return value
        }

        private static func boundedText(_ value: String, maximum: Int) throws -> String {
            let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty, trimmed.count <= maximum else {
                throw DecodingError.dataCorrupted(
                    .init(codingPath: [], debugDescription: "Provider limit text is invalid")
                )
            }
            return trimmed
        }
    }

    enum RateLimits: Equatable {
        case known(updatedAt: UInt64, windows: [LimitWindow])
        case notReported
        case pending
    }

    let id: String
    let name: String
    let status: RuntimeStatus
    let authentication: Authentication
    let planLabel: String?
    let accountLabel: String?
    let rateLimits: RateLimits

    private enum CodingKeys: String, CodingKey {
        case accountLabel
        case authentication = "auth"
        case id
        case name
        case planLabel
        case rateLimits
        case status
    }

    private struct KnownRateLimits: Decodable {
        let updatedAt: UInt64
        let windows: [LimitWindow]
    }

    init(from decoder: any Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = try Self.boundedText(values.decode(String.self, forKey: .id), maximum: 64)
        name = try Self.boundedText(values.decode(String.self, forKey: .name), maximum: 64)
        status = try values.decode(RuntimeStatus.self, forKey: .status)
        authentication = try values.decode(Authentication.self, forKey: .authentication)
        planLabel = try Self.optionalBoundedText(
            values.decodeIfPresent(String.self, forKey: .planLabel),
            maximum: 64
        )
        accountLabel = try Self.optionalBoundedText(
            values.decodeIfPresent(String.self, forKey: .accountLabel),
            maximum: 254
        )
        if !values.contains(.rateLimits) {
            rateLimits = .notReported
        } else if try values.decodeNil(forKey: .rateLimits) {
            rateLimits = .pending
        } else {
            let limits = try values.decode(KnownRateLimits.self, forKey: .rateLimits)
            guard limits.updatedAt > 0, limits.windows.count <= 16 else {
                throw DecodingError.dataCorruptedError(
                    forKey: .rateLimits,
                    in: values,
                    debugDescription: "Provider limits exceed their bounded contract"
                )
            }
            rateLimits = .known(updatedAt: limits.updatedAt, windows: limits.windows)
        }
    }

    var isVisibleInMenu: Bool {
        id != "codex" && status != .disabled
    }

    var summary: String {
        switch status {
        case .disabled:
            return "Disabled"
        case .reconnecting:
            return "Reconnecting"
        case .unavailable:
            return "Unavailable"
        case .live:
            break
        }
        switch authentication {
        case .unauthenticated:
            return "Not signed in"
        case .unknown:
            return "Sign-in status unknown"
        case .authenticated:
            let plan = planTitle
            guard let limit = primaryLimit, let remaining = limit.remainingPercent else {
                return plan.map { "\($0) · Signed in" } ?? "Signed in"
            }
            let allowance = "\(remaining)% \(limit.kind == .weekly ? "weekly " : "")left"
            return plan.map { "\($0) · \(allowance)" } ?? allowance
        }
    }

    var planTitle: String? {
        planLabel.map(Self.planTitle)
    }

    var limitWindows: [LimitWindow] {
        guard case let .known(_, windows) = rateLimits else { return [] }
        return windows.sorted { left, right in
            Self.limitRank(left.kind) < Self.limitRank(right.kind)
        }
    }

    private var primaryLimit: LimitWindow? {
        limitWindows.first(where: { $0.kind == .weekly })
            ?? limitWindows.first(where: { $0.kind == .session })
            ?? limitWindows.first
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

    private static func planTitle(_ value: String) -> String {
        value.replacingOccurrences(of: "_", with: " ").capitalized
    }

    private static func limitRank(_ kind: LimitKind) -> Int {
        switch kind {
        case .weekly: 0
        case .session: 1
        case .other: 2
        }
    }

    private static func optionalBoundedText(_ value: String?, maximum: Int) throws -> String? {
        guard let value else { return nil }
        return try boundedText(value, maximum: maximum)
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
