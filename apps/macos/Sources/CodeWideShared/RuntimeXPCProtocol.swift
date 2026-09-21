import Foundation

@objc public protocol RuntimeXPCProtocol {
    func health(
        withReply reply: @escaping @Sendable (RuntimeHealthPayload?, NSError?) -> Void
    )

    func prepareForUpdate(
        targetVersion: String,
        withReply reply: @escaping @Sendable (RuntimeHealthPayload?, NSError?) -> Void
    )
}

public func makeRuntimeXPCInterface() -> NSXPCInterface {
    NSXPCInterface(with: RuntimeXPCProtocol.self)
}
