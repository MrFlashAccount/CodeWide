import Foundation

struct RelayUpdateView: Decodable, Equatable, Sendable {
    let currentVersion: String
    let capability: RelayUpdateCapability
    let availableTarget: RelayUpdateTarget?
    let activeOperation: RelayUpdateOperation?

    var isBusy: Bool {
        guard let phase = activeOperation?.phase else { return false }
        return !["committed", "rolledBack", "failed"].contains(phase)
    }

    var failureMessage: String? {
        guard let operation = activeOperation,
              ["rolledBack", "failed"].contains(operation.phase)
        else { return nil }
        return operation.errorMessage ?? "Relay update did not complete."
    }
}

struct RelayUpdateCapability: Decodable, Equatable, Sendable {
    let applySupported: Bool
    let unavailableReason: String?
}

struct RelayUpdateTarget: Decodable, Equatable, Sendable {
    let version: String
    let targetFingerprint: String
}

struct RelayUpdateOperation: Decodable, Equatable, Sendable {
    let operationId: String
    let phase: String
    let targetVersion: String
    let errorCode: String?
    let errorMessage: String?
}

struct RelayUpdateAccepted: Decodable, Equatable, Sendable {
    let operationId: String
    let phase: String
}

enum RelayUpdateCodec {
    static func status(_ json: String) throws -> RelayUpdateView {
        try JSONDecoder().decode(RelayUpdateView.self, from: Data(json.utf8))
    }

    static func accepted(_ json: String) throws -> RelayUpdateAccepted {
        try JSONDecoder().decode(RelayUpdateAccepted.self, from: Data(json.utf8))
    }
}
