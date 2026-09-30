import CodeWideShared
import CompanionSwiftFFI
import Foundation
import ServiceManagement
import Testing
@testable import CodeWide
@testable import CodeWideRuntime

/// Exercises the real XPC codecs, Swift service and Rust core without launchd registration.
/// Bundle-signature checks and the installed helper lifecycle remain separate release gates.
@Test(.timeLimit(.minutes(1))) @MainActor
func nativeManagementCrossesXPCIntoTheRustCore() async throws {
    let root = FileManager.default.temporaryDirectory
        .appending(path: "codewide-xpc-test-\(UUID().uuidString)", directoryHint: .isDirectory)
    let state = root.appending(path: "state", directoryHint: .isDirectory)
    let codex = root.appending(path: ".codex", directoryHint: .isDirectory)
    try FileManager.default.createDirectory(at: codex, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: root) }

    let core = try CoreHost(
        stateDirectory: state.path, codexHome: codex.path,
        appVersion: "1.0.0", hostVersion: "1.0.0", computerName: "XPC test", listenAddress: "127.0.0.1:0"
    )
    let service = RuntimeService(
        core: core,
        runtimeExecutablePath: "/test/CodeWide.app/Contents/MacOS/CodeWideRuntime",
        selectionStore: AppServerSelectionStore(stateDirectory: state, userHome: root),
        selectedCodexHome: codex,
        userHome: root
    )
    let delegate = TestXPCListener(service: service)
    let listener = NSXPCListener.anonymous()
    listener.delegate = delegate
    listener.resume()
    defer { listener.invalidate() }

    let connection = NSXPCConnection(listenerEndpoint: listener.endpoint)
    connection.remoteObjectInterface = makeRuntimeXPCInterface()
    connection.resume()
    defer { connection.invalidate() }

    let runtime = RuntimeConnection(
        launchAgent: EnabledTestAgent(),
        proxyProvider: { handler in
            connection.remoteObjectProxyWithErrorHandler(handler) as? RuntimeXPCProtocol
        },
        runtimeValidator: { $0.appVersion == "1.0.0" && $0.hostVersion == "1.0.0" },
        reportsUpdateHealth: false
    )
    await runtime.refresh()
    #expect(runtime.lastError == nil)
    #expect(runtime.health?.phase == "running")
    #expect(runtime.appServer?.codexHome == codex.path)
    #expect(runtime.appServer?.state == .unavailable(lastKnownVersion: nil))
    #expect(runtime.relay?.configured == false)
    #expect(runtime.devices.isEmpty)
    #expect(!runtime.appServers.isEmpty)
    let pairing = try await runtime.createPairing()
    let link = try #require(URLComponents(string: pairing.link))
    let endpoint = link.queryItems?.first(where: { $0.name == "e" })?.value
    #expect(endpoint == runtime.directAccess?.endpoints.first)
    #expect(link.queryItems?.first(where: { $0.name == "v" })?.value == "1")
    do {
        try await runtime.selectAppServer(id: "missing-profile")
        Issue.record("Selecting a missing profile must fail without restarting the helper")
    } catch {
        #expect(error.localizedDescription ==
            "The selected Codex App Server is no longer available."
        )
    }
    // The failed management action must not poison the next round trip.
    await runtime.refresh()
    #expect(runtime.health?.phase == "running")
    #expect(runtime.lastError == nil)
    withExtendedLifetime(delegate) {}
}

private final class TestXPCListener: NSObject, NSXPCListenerDelegate {
    let service: RuntimeService

    init(service: RuntimeService) { self.service = service }

    func listener(
        _ listener: NSXPCListener,
        shouldAcceptNewConnection connection: NSXPCConnection
    ) -> Bool {
        connection.exportedInterface = makeRuntimeXPCInterface()
        connection.exportedObject = service
        connection.resume()
        return true
    }
}

@MainActor
private final class EnabledTestAgent: RuntimeAgentService {
    var status: SMAppService.Status { .enabled }
    func register() throws { Issue.record("The XPC integration test must never register a service") }
    func unregister() async throws {
        Issue.record("The XPC integration test must never unregister a service")
    }
}
