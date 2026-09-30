import Foundation

/// Enrollment presentation only. Relay credentials remain in the Rust runtime.
public final class RelayEnrollmentPayload: NSObject, NSSecureCoding, @unchecked Sendable {
    public static let supportsSecureCoding = true
    public let id: String
    public let state: String
    public let code: String?
    public let remainingSeconds: UInt32
    public let message: String?

    public init(id: String, state: String, code: String?, remainingSeconds: UInt32, message: String?) {
        self.id = id
        self.state = state
        self.code = code
        self.remainingSeconds = remainingSeconds
        self.message = message
    }

    public required init?(coder: NSCoder) {
        guard
            let id = coder.decodeObject(of: NSString.self, forKey: "id") as String?,
            id.count == 64,
            let state = coder.decodeObject(of: NSString.self, forKey: "state") as String?,
            ["connecting", "confirm", "activating", "connected", "failed", "cancelled"].contains(state)
        else { return nil }
        let remaining = coder.decodeInteger(forKey: "remainingSeconds")
        guard (0...60).contains(remaining) else { return nil }
        self.id = id
        self.state = state
        code = coder.decodeObject(of: NSString.self, forKey: "code") as String?
        remainingSeconds = UInt32(remaining)
        message = coder.decodeObject(of: NSString.self, forKey: "message") as String?
    }

    public func encode(with coder: NSCoder) {
        coder.encode(id, forKey: "id")
        coder.encode(state, forKey: "state")
        coder.encode(code, forKey: "code")
        coder.encode(Int(remainingSeconds), forKey: "remainingSeconds")
        coder.encode(message, forKey: "message")
    }
}
