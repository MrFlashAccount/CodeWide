import CodeWideShared
import Foundation
import ServiceManagement
import Testing
@testable import CodeWide

@Suite(.timeLimit(.minutes(1)))
@MainActor
struct RuntimeConnectionTests {
    private func makeRuntime(
        agent: TestAgent = TestAgent(),
        service: TestRuntimeService = TestRuntimeService(),
        registration: RuntimeRegistration? = nil
    ) -> RuntimeConnection {
        RuntimeConnection(
            launchAgent: agent,
            proxyProvider: { _ in service },
            runtimeValidator: { _ in true },
            reportsUpdateHealth: false,
            registration: registration
        )
    }

    @Test func closingRelaySetupDuringInitialReplyCancelsTheReturnedAttempt() async throws {
        let service = TestRuntimeService()
        service.holdEnrollmentStart = true
        let model = RelaySetupModel(runtime: makeRuntime(service: service))
        model.connect(address: " 127.0.0.1:8780 ")
        while service.pendingEnrollmentStart == nil { await Task.yield() }
        #expect(service.enrollmentAddress == "127.0.0.1:8780")
        model.cancel()
        let reply = try #require(service.pendingEnrollmentStart)
        service.pendingEnrollmentStart = nil
        reply(RelayEnrollmentPayload(id: String(repeating: "a", count: 64), state: "connecting", code: nil, remainingSeconds: 0, message: nil), nil)
        while model.isSubmitting { await Task.yield() }
        #expect(service.cancelledEnrollments == [String(repeating: "a", count: 64)])
        #expect(model.error == nil)
    }

    @Test func closingRelaySetupDuringConfirmationCancelsOnlyItsAttempt() async {
        let service = TestRuntimeService()
        let model = RelaySetupModel(runtime: makeRuntime(service: service))
        model.connect(address: "127.0.0.1:8780")
        while model.enrollment?.state != "confirm" { await Task.yield() }
        #expect(model.enrollment?.code == "🍋  🚀  🐳  🎸\nLemon · Rocket · Whale · Guitar")
        model.cancel()
        while service.cancelledEnrollments.isEmpty { await Task.yield() }
        #expect(service.cancelledEnrollments == [String(repeating: "a", count: 64)])
    }

    @Test func approvalCanRecoverWithoutRelaunching() async {
        let agent = TestAgent()
        agent.status = .requiresApproval
        let service = TestRuntimeService()
        let runtime = makeRuntime(agent: agent, service: service)
        await runtime.refresh()
        #expect(runtime.requiresApproval)
        #expect(runtime.health == nil)
        #expect(service.healthRequests == 0)
        agent.status = .enabled
        await runtime.refresh()
        #expect(!runtime.requiresApproval)
        #expect(runtime.health?.phase == "running")
        #expect(runtime.relay?.connection == "online")
        #expect(runtime.devices.count == 1)
    }

    @Test func registrationFailureRemainsActionable() async {
        let agent = TestAgent()
        agent.status = .notRegistered
        agent.failure = NSError(domain: "test", code: 1)
        let service = TestRuntimeService()
        let runtime = makeRuntime(agent: agent, service: service)
        await runtime.refresh()
        #expect(runtime.status == "Registration failed")
        #expect(runtime.lastError != nil)
        #expect(service.healthRequests == 0)
        agent.failure = nil
        await runtime.refresh()
        #expect(runtime.health != nil)
    }

    @Test func discoveryWaitsForBackgroundServiceApproval() async {
        let agent = TestAgent()
        agent.status = .requiresApproval
        let service = TestRuntimeService()
        let runtime = makeRuntime(agent: agent, service: service)
        await runtime.discoverAppServers()
        #expect(runtime.requiresApproval)
        #expect(!runtime.hasDiscoveredAppServers)
        #expect(!runtime.isDiscoveringAppServers)
        #expect(service.healthRequests == 0)
        #expect(service.discoveryRequests == 0)
        #expect(runtime.lastError?.contains("Login Items") == true)
    }

    @Test func discoveryFailureDoesNotLookLikeAnEmptySuccessfulScan() async {
        let service = TestRuntimeService()
        let runtime = makeRuntime(service: service)
        await runtime.discoverAppServers()
        #expect(runtime.health != nil)
        #expect(runtime.hasDiscoveredAppServers)
        service.discoveryFailure = NSError(domain: "test", code: 3)
        await runtime.discoverAppServers()
        #expect(!runtime.hasDiscoveredAppServers)
        #expect(runtime.lastError != nil)
    }

    @Test func changedBuildWaitsForUnregistrationAndRecordsOnlyHealthyRegistration() async {
        var recorded: String? = "old-build"
        let registration = RuntimeRegistration(
            build: "new-build", read: { recorded }, write: { recorded = $0 }
        )
        let agent = TestAgent()
        agent.holdUnregister = true
        let service = TestRuntimeService()
        service.healthFailure = NSError(domain: "test", code: 4)
        let runtime = makeRuntime(agent: agent, service: service, registration: registration)
        let first = Task { await runtime.refresh() }
        while agent.pendingUnregister == nil { await Task.yield() }
        #expect(agent.registerCalls == 0)
        #expect(service.healthRequests == 0)
        agent.pendingUnregister?.resume()
        agent.pendingUnregister = nil
        await first.value
        #expect(recorded == "old-build")
        #expect(agent.unregisterCalls == 1)
        #expect(agent.registerCalls == 1)

        service.healthFailure = nil
        await runtime.refresh()
        #expect(recorded == "new-build")
        #expect(runtime.health != nil)
        #expect(agent.unregisterCalls == 1)
        #expect(agent.registerCalls == 1)
    }

    @Test func unchangedBuildDoesNotRestartTheBackgroundService() async {
        let registration = RuntimeRegistration(
            build: "current", read: { "current" }, write: { _ in }
        )
        let agent = TestAgent()
        let runtime = makeRuntime(agent: agent, registration: registration)
        await runtime.refresh()
        #expect(runtime.health != nil)
        #expect(agent.unregisterCalls == 0)
        #expect(agent.registerCalls == 0)
    }

    @Test func newBuildRecoversAnInitialXPCFailureWithoutRelaunching() async {
        var recorded: String? = "old-build"
        let registration = RuntimeRegistration(
            build: "new-build", read: { recorded }, write: { recorded = $0 }
        )
        let agent = TestAgent()
        let service = TestRuntimeService()
        service.healthFailure = NSError(domain: NSCocoaErrorDomain, code: 4099)
        let runtime = makeRuntime(agent: agent, service: service, registration: registration)
        await runtime.refresh()
        #expect(runtime.health == nil)
        #expect(recorded == "old-build")
        service.healthFailure = nil
        await runtime.refresh()
        #expect(runtime.health != nil)
        #expect(recorded == "new-build")
        #expect(agent.unregisterCalls == 2)
        #expect(agent.registerCalls == 2)
        // A later outage of a previously healthy helper is not another update.
        service.healthFailure = NSError(domain: NSCocoaErrorDomain, code: 4099)
        await runtime.refresh()
        await runtime.refresh()
        #expect(agent.registerCalls == 2)
    }

    @Test func failedBuildRecoveryDoesNotLoopRegistration() async {
        let registration = RuntimeRegistration(
            build: "new-build", read: { "old-build" }, write: { _ in }
        )
        let agent = TestAgent()
        let service = TestRuntimeService()
        service.healthFailure = NSError(domain: NSCocoaErrorDomain, code: 4099)
        let runtime = makeRuntime(agent: agent, service: service, registration: registration)
        for _ in 0..<4 { await runtime.refresh() }
        #expect(runtime.health == nil)
        #expect(runtime.lastError != nil)
        #expect(agent.unregisterCalls == 2)
        #expect(agent.registerCalls == 2)
    }

    @Test func changedBuildStillWaitsForUserApproval() async {
        var recorded: String? = "old"
        let registration = RuntimeRegistration(
            build: "new", read: { recorded }, write: { recorded = $0 }
        )
        let agent = TestAgent()
        agent.status = .requiresApproval
        let runtime = makeRuntime(agent: agent, registration: registration)
        await runtime.refresh()
        #expect(runtime.requiresApproval)
        #expect(recorded == "old")
        #expect(agent.unregisterCalls == 0)
        #expect(agent.registerCalls == 0)
        agent.status = .enabled
        await runtime.refresh()
        #expect(!runtime.requiresApproval)
        #expect(recorded == "new")
        #expect(agent.unregisterCalls == 1)
        #expect(agent.registerCalls == 1)
    }

    @Test func managementFailureClearsStaleOnlineStateAndRecovers() async {
        let service = TestRuntimeService()
        let runtime = makeRuntime(service: service)
        await runtime.refresh()
        #expect(runtime.devices.count == 1)
        service.relayFailure = NSError(domain: "test", code: 2)
        await runtime.refresh()
        #expect(runtime.relay == nil)
        #expect(runtime.devices.isEmpty)
        #expect(runtime.lastError != nil)
        service.relayFailure = nil
        await runtime.refresh()
        #expect(runtime.relay?.connection == "online")
        #expect(runtime.devices.count == 1)
        #expect(runtime.lastError == nil)
    }

    @Test func directPairingUsesTheSelectedAddressWithoutAnOnlineRelay() async throws {
        let service = TestRuntimeService()
        service.relayEnabled = false
        service.directEndpoints = ["wss://192.0.2.1:8766/v1/sync", "wss://192.0.2.2:8766/v1/sync"]
        let runtime = makeRuntime(service: service)
        await runtime.refresh()
        runtime.pairingEndpoint = service.directEndpoints[1]
        _ = try await runtime.createPairing()
        #expect(service.lastPairingEndpoint == service.directEndpoints[1])

        service.directEndpoints.removeLast()
        await runtime.refresh()
        #expect(runtime.pairingEndpoint == service.directEndpoints.first)
        service.directEndpoints = []
        await runtime.refresh()
        #expect(runtime.pairingEndpoint == nil)
        do {
            _ = try await runtime.createPairing()
            Issue.record("An offline Mac must not create a link with an obsolete address")
        } catch {
            #expect(error.localizedDescription.contains("Connect this Mac to a network"))
        }
    }

    @Test func relayPairingRequestsTheRelayTransportEvenWhenDirectAccessIsAvailable() async throws {
        let service = TestRuntimeService()
        let runtime = makeRuntime(service: service)
        await runtime.refresh()
        _ = try await runtime.createPairing()
        #expect(service.lastPairingEndpoint == nil)
        #expect(runtime.preferredPairingRoute == .relay)
        _ = try await runtime.createPairing(route: .direct)
        #expect(service.lastPairingEndpoint == service.directEndpoints.first)

        service.directEndpoints = []
        await runtime.refresh()
        _ = try await runtime.createPairing(route: .relay)
        #expect(service.lastPairingEndpoint == nil)

        try await runtime.setRelayEnabled(false)
        do {
            _ = try await runtime.createPairing(route: .relay)
            Issue.record("A disabled Relay must not create a direct invitation as a fallback")
        } catch {
            #expect(error.localizedDescription == "Connect a Relay before creating a Relay QR code.")
        }
    }

    @Test func untrustedRuntimeCannotPublishManagementState() async {
        let service = TestRuntimeService()
        let runtime = RuntimeConnection(
            launchAgent: TestAgent(),
            proxyProvider: { _ in service },
            runtimeValidator: { _ in false },
            reportsUpdateHealth: false
        )
        await runtime.refresh()
        #expect(runtime.health == nil)
        #expect(runtime.devices.isEmpty)
        #expect(service.managementRequests == 0)
    }

    @Test func refreshesDoNotOverlap() async {
        let service = TestRuntimeService()
        service.holdHealth = true
        let runtime = makeRuntime(service: service)
        let first = Task { await runtime.refresh() }
        while service.pendingHealth == nil { await Task.yield() }
        await runtime.refresh()
        #expect(service.healthRequests == 1)
        service.pendingHealth?(TestRuntimeService.healthy, nil)
        service.pendingHealth = nil
        await first.value
        #expect(runtime.devices.count == 1)
    }

    @Test func oldRefreshCannotOverwriteSelectedServer() async throws {
        let service = TestRuntimeService()
        service.holdHealth = true
        let runtime = makeRuntime(service: service)
        let first = Task { await runtime.refresh() }
        while service.pendingHealth == nil { await Task.yield() }
        try await runtime.selectAppServer(id: "work")
        service.pendingHealth?(TestRuntimeService.healthy, nil)
        service.pendingHealth = nil
        await first.value
        #expect(runtime.health == nil)
        #expect(runtime.appServer?.id == "work")
        #expect(runtime.status == "Switching App Server")
        #expect(service.managementRequests == 0)
    }

    @Test func updateCheckpointStopsRefreshAndRejectsAnOldHealthReply() async throws {
        let service = TestRuntimeService()
        service.holdHealth = true
        let runtime = makeRuntime(service: service)
        let first = Task { await runtime.refresh() }
        while service.pendingHealth == nil { await Task.yield() }

        try await runtime.prepareForUpdate(targetVersion: "1.1.0")
        service.pendingHealth?(TestRuntimeService.healthy, nil)
        service.pendingHealth = nil
        await first.value
        await runtime.refresh()

        #expect(runtime.health?.updateStatus == "prepared")
        #expect(runtime.health?.updateTargetVersion == "1.1.0")
        #expect(runtime.status == "Preparing update")
        #expect(service.healthRequests == 1)
        #expect(service.managementRequests == 0)
    }

    @Test func oldSnapshotCannotUndoRelayDisableOrDeviceRevocation() async throws {
        let service = TestRuntimeService()
        let runtime = makeRuntime(service: service)
        await runtime.refresh()
        let oldDevices = runtime.devices
        service.holdDevices = true
        let first = Task { await runtime.refresh() }
        while service.pendingDevices == nil { await Task.yield() }

        try await runtime.setRelayEnabled(false)
        try await runtime.revokeDevice(id: "phone")
        service.pendingDevices?(DeviceListPayload(devices: oldDevices), nil)
        service.pendingDevices = nil
        await first.value

        #expect(runtime.relay?.enabled == false)
        #expect(runtime.devices.isEmpty)
    }
}

@MainActor
private final class TestAgent: RuntimeAgentService {
    var status = SMAppService.Status.enabled
    var failure: Error?
    var registerCalls = 0
    var unregisterCalls = 0
    var holdUnregister = false
    var pendingUnregister: CheckedContinuation<Void, any Error>?
    func register() throws {
        registerCalls += 1
        if let failure { throw failure }
        status = .enabled
    }
    func unregister() async throws {
        unregisterCalls += 1
        if holdUnregister {
            try await withCheckedThrowingContinuation { pendingUnregister = $0 }
        }
        status = .notRegistered
    }
}

// Calls run on the test's main actor; callback signatures match the production XPC protocol.
private final class TestRuntimeService: NSObject, RuntimeXPCProtocol, @unchecked Sendable {
    var healthRequests = 0
    var managementRequests = 0
    var relayFailure: NSError?
    var healthFailure: NSError?
    var discoveryFailure: NSError?
    var discoveryRequests = 0
    var holdHealth = false
    var pendingHealth: (@Sendable (RuntimeHealthPayload?, NSError?) -> Void)?
    var holdDevices = false
    var pendingDevices: (@Sendable (DeviceListPayload?, NSError?) -> Void)?
    var relayEnabled = true
    var directEndpoints = ["wss://192.0.2.1:8766/v1/sync"]
    var lastPairingEndpoint: String?
    var holdEnrollmentStart = false
    var pendingEnrollmentStart: (@Sendable (RelayEnrollmentPayload?, NSError?) -> Void)?
    var enrollmentAddress: String?
    var cancelledEnrollments: [String] = []

    static var healthy: RuntimeHealthPayload {
        RuntimeHealthPayload(
            phase: "running", degradedReason: nil,
            appVersion: "1.0.0", hostVersion: "1.0.0", coreVersion: "1.0.0",
            stateSchema: 1, processID: 123, launchCount: 1,
            startedAtUnixMilliseconds: 1, updateStatus: "none",
            updateFromVersion: nil, updateTargetVersion: nil, updateFailureReason: nil,
            hostExecutablePath: "/test/CodeWide.app/Contents/MacOS/CodeWideRuntime"
        )
    }

    func health(withReply reply: @escaping @Sendable (RuntimeHealthPayload?, NSError?) -> Void) {
        healthRequests += 1
        if let healthFailure { reply(nil, healthFailure); return }
        if holdHealth { pendingHealth = reply } else { reply(Self.healthy, nil) }
    }

    func appServer(withReply reply: @escaping @Sendable (AppServerPayload?, NSError?) -> Void) {
        managementRequests += 1
        reply(server("default"), nil)
    }

    private func server(_ id: String) -> AppServerPayload {
        AppServerPayload(
            id: id, displayName: id, codexHome: "/test/.codex",
            state: .available(version: "0.155.1"), selected: true
        )
    }

    func discoverAppServers(
        withReply reply: @escaping @Sendable (AppServerListPayload?, NSError?) -> Void
    ) {
        discoveryRequests += 1
        if let discoveryFailure { reply(nil, discoveryFailure); return }
        reply(AppServerListPayload(
            servers: [server("default")],
            codexInstallation: CodexInstallationPayload(state: .ready(installedVersion: "0.155.1"))
        ), nil)
    }

    func selectAppServer(id: String, withReply reply: @escaping @Sendable (AppServerPayload?, NSError?) -> Void) {
        reply(server(id), nil)
    }

    func startAppServer(id: String, withReply reply: @escaping @Sendable (AppServerPayload?, NSError?) -> Void) {
        reply(server(id), nil)
    }

    func directAccess(withReply reply: @escaping @Sendable (DirectAccessPayload?, NSError?) -> Void) {
        reply(DirectAccessPayload(listenAddress: "0.0.0.0:8766", endpoints: directEndpoints), nil)
    }

    func relayStatus(withReply reply: @escaping @Sendable (RelayStatusPayload?, NSError?) -> Void) {
        if let relayFailure { reply(nil, relayFailure); return }
        reply(RelayStatusPayload(configured: true, enabled: relayEnabled, connection: relayEnabled ? "online" : "disabled", publicEndpoint: "wss://test.invalid"), nil)
    }

    func devices(withReply reply: @escaping @Sendable (DeviceListPayload?, NSError?) -> Void) {
        if holdDevices { pendingDevices = reply; return }
        reply(DeviceListPayload(devices: [
            DeviceStatusPayload(id: "phone", name: "Phone", createdAtUnixMilliseconds: 1, lastSeenAtUnixMilliseconds: 2, activeConnections: 1),
        ]), nil)
    }

    func prepareForUpdate(targetVersion: String, withReply reply: @escaping @Sendable (RuntimeHealthPayload?, NSError?) -> Void) {
        reply(RuntimeHealthPayload(
            phase: "preparingUpdate", degradedReason: nil,
            appVersion: "1.0.0", hostVersion: "1.0.0", coreVersion: "1.0.0",
            stateSchema: 1, processID: 123, launchCount: 1,
            startedAtUnixMilliseconds: 1, updateStatus: "prepared",
            updateFromVersion: "1.0.0", updateTargetVersion: targetVersion, updateFailureReason: nil,
            hostExecutablePath: "/test/CodeWide.app/Contents/MacOS/CodeWideRuntime"
        ), nil)
    }

    func pairRelay(address: String, invitationJSON: String, withReply reply: @escaping @Sendable (RelayStatusPayload?, NSError?) -> Void) {
        relayStatus(withReply: reply)
    }

    func beginRelayEnrollment(address: String, withReply reply: @escaping @Sendable (RelayEnrollmentPayload?, NSError?) -> Void) {
        enrollmentAddress = address
        if holdEnrollmentStart { pendingEnrollmentStart = reply; return }
        relayEnrollmentStatus(id: String(repeating: "a", count: 64), withReply: reply)
    }

    func relayEnrollmentStatus(id: String, withReply reply: @escaping @Sendable (RelayEnrollmentPayload?, NSError?) -> Void) {
        reply(RelayEnrollmentPayload(id: id, state: "confirm", code: "🍋  🚀  🐳  🎸\nLemon · Rocket · Whale · Guitar", remainingSeconds: 40, message: nil), nil)
    }

    func cancelRelayEnrollment(id: String, withReply reply: @escaping @Sendable (Bool, NSError?) -> Void) {
        cancelledEnrollments.append(id)
        reply(true, nil)
    }

    func setRelayEnabled(_ enabled: Bool, withReply reply: @escaping @Sendable (RelayStatusPayload?, NSError?) -> Void) {
        relayEnabled = enabled
        relayStatus(withReply: reply)
    }

    func createPairing(directEndpoint: String?, withReply reply: @escaping @Sendable (PairingPayload?, NSError?) -> Void) {
        lastPairingEndpoint = directEndpoint
        reply(PairingPayload(link: "codewide://test", expiresAtUnixMilliseconds: 123), nil)
    }

    func revokeDevice(id: String, withReply reply: @escaping @Sendable (Bool, NSError?) -> Void) {
        reply(true, nil)
    }
}
