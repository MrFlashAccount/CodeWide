import CodeWideShared
import Foundation

final class RuntimeListenerDelegate: NSObject, NSXPCListenerDelegate {
    private let service: RuntimeService
    private let runtimeExecutableURL: URL

    init(service: RuntimeService, runtimeExecutableURL: URL) {
        self.service = service
        self.runtimeExecutableURL = runtimeExecutableURL
    }

    func listener(
        _ listener: NSXPCListener,
        shouldAcceptNewConnection connection: NSXPCConnection
    ) -> Bool {
        guard AdHocPeerValidator.acceptsAppClient(
            connection,
            runtimeExecutableURL: runtimeExecutableURL
        ) else {
            return false
        }
        connection.setCodeSigningRequirement(RuntimeConstants.appCodeSigningRequirement)
        connection.exportedInterface = makeRuntimeXPCInterface()
        connection.exportedObject = service
        connection.resume()
        return true
    }
}
