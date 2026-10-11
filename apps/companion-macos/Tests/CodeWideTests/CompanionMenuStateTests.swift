import CodeWideShared
import Testing
@testable import CodeWide

struct CompanionMenuStateTests {
    private func health(phase: String = "running") -> RuntimeHealthPayload {
        RuntimeHealthPayload(
            phase: phase, degradedReason: nil, appVersion: "0.4.0", hostVersion: "0.4.0",
            coreVersion: "0.4.0", stateSchema: 1, processID: 1, launchCount: 1,
            startedAtUnixMilliseconds: 1, updateStatus: "none", updateFromVersion: nil,
            updateTargetVersion: nil, updateFailureReason: nil, hostExecutablePath: "/test/CodeWideRuntime"
        )
    }

    private var server: AppServerPayload {
        AppServerPayload(id: "test", displayName: "Test", codexHome: "/test",
                         state: .available(version: "0.157.0"), selected: true)
    }

    private var direct: DirectAccessPayload {
        DirectAccessPayload(listenAddress: "0.0.0.0:8767", endpoints: ["wss://192.0.2.1:8767/v1/sync"])
    }

    @Test func permissionIsRequiredEvenWithAnOldHealthySnapshot() {
        let state = CompanionMenuConnection(health: health(), server: server, directAccess: direct,
                                           requiresApproval: true, runtimeStatus: "Running")
        #expect(state == .needsPermission)
    }

    @Test func missingRuntimeNeverLooksConnected() {
        let state = CompanionMenuConnection(health: nil, server: server, directAccess: direct,
                                           requiresApproval: false, runtimeStatus: "Unavailable")
        #expect(state == .helperUnavailable)
    }

    @Test func initialConnectionIsNotReportedAsFailure() {
        let state = CompanionMenuConnection(health: nil, server: nil, directAccess: nil,
                                           requiresApproval: false, runtimeStatus: "Starting")
        #expect(state == .starting)
    }

    @Test(arguments: ["preparingUpdate", "degraded", "stopped"])
    func pausedOrDegradedRuntimeDoesNotOfferPairing(phase: String) {
        let state = CompanionMenuConnection(health: health(phase: phase), server: server,
                                           directAccess: direct, requiresApproval: false,
                                           runtimeStatus: phase)
        #expect(state == .helperUnavailable)
    }

    @Test func runningHelperDoesNotProveCodexIsConnected() {
        let unavailable = AppServerPayload(id: "test", displayName: "Test", codexHome: "/test",
                                          state: .unavailable(lastKnownVersion: "0.157.0"), selected: true)
        let state = CompanionMenuConnection(health: health(), server: unavailable, directAccess: direct,
                                           requiresApproval: false, runtimeStatus: "Running")
        #expect(state == .codexUnavailable)
    }

    @Test func wildcardListenerAloneIsNotAPairingAddress() {
        let state = CompanionMenuConnection(
            health: health(), server: server,
            directAccess: DirectAccessPayload(listenAddress: "0.0.0.0:8767", endpoints: []),
            requiresApproval: false, runtimeStatus: "Running"
        )
        #expect(state == .networkUnavailable)
    }

    @Test func availableLocalServicesPermitExplicitPairing() {
        let state = CompanionMenuConnection(health: health(), server: server, directAccess: direct,
                                           requiresApproval: false, runtimeStatus: "Running")
        #expect(state == .connected)
    }

    @Test func onlineRelayKeepsPairingAvailableWithoutADirectAddress() {
        let relay = RelayStatusPayload(configured: true, enabled: true, connection: "online",
                                       publicEndpoint: "wss://relay.example:8780")
        let state = CompanionMenuConnection(
            health: health(), server: server,
            directAccess: DirectAccessPayload(listenAddress: "0.0.0.0:8767", endpoints: []),
            relay: relay, requiresApproval: false, runtimeStatus: "Running"
        )
        #expect(state == .connected)
    }

    @Test(arguments: [
        (nil as RelayStatusPayload?, CompanionRelayStatus.notConfigured),
        (RelayStatusPayload(configured: true, enabled: false, connection: "disabled", publicEndpoint: nil),
         CompanionRelayStatus.disabled),
        (RelayStatusPayload(configured: true, enabled: true, connection: "connecting", publicEndpoint: nil),
         CompanionRelayStatus.connecting),
        (RelayStatusPayload(configured: true, enabled: true, connection: "reconnecting", publicEndpoint: nil),
         CompanionRelayStatus.connecting),
        (RelayStatusPayload(configured: true, enabled: true, connection: "online", publicEndpoint: nil),
         CompanionRelayStatus.connected),
    ])
    func relayStatusRemainsVisibleAndTruthful(
        payload: RelayStatusPayload?, expected: CompanionRelayStatus
    ) {
        #expect(CompanionRelayStatus(payload) == expected)
    }

    @Test func staleDeviceConnectionsAreNotPresentedAsOnline() {
        var snapshot = CompanionMenuSnapshot(connection: .helperUnavailable)
        snapshot.devices = [DeviceStatusPayload(id: "test", name: "Test phone",
                                                createdAtUnixMilliseconds: 1,
                                                lastSeenAtUnixMilliseconds: 1, activeConnections: 1)]
        #expect(snapshot.devicesSummary == "Status unavailable")
        snapshot.connection = .connected
        #expect(snapshot.devicesSummary == "1 of 1 connected")
    }

    @Test func claudeSubscriptionIsProjectedBesideCodex() throws {
        let providers = try CompanionAgentProvider.decodeList("""
        {"providers":[
          {"id":"codex","name":"Codex","status":"live","auth":"unknown","planLabel":null},
          {"id":"claude","name":"Claude","status":"live","auth":"authenticated","planLabel":"max","accountLabel":"dev@example.com","rateLimits":{"updatedAt":1800000000,"windows":[
            {"id":"five_hour","kind":"session","label":"Session","resetsAt":1800010000,"status":"allowed","usedPercent":25,"windowDurationMins":300},
            {"id":"seven_day","kind":"weekly","label":"Weekly","resetsAt":1800300000,"status":"allowed","usedPercent":60,"windowDurationMins":10080}
          ]}}
        ]}
        """)
        var snapshot = CompanionMenuSnapshot(connection: .connected)
        snapshot.agentProviders = providers

        let claude = try #require(snapshot.visibleAgentProviders.first)
        #expect(snapshot.visibleAgentProviders.count == 1)
        #expect(claude.id == "claude")
        #expect(claude.summary == "Max · 40% weekly left")
        #expect(claude.limitWindows.map(\.kind) == [.weekly, .session])
        #expect(claude.accountLabel == "dev@example.com")
    }

    @Test func signedOutClaudeRemainsVisibleWithoutFakeUsage() throws {
        let providers = try CompanionAgentProvider.decodeList("""
        {"providers":[{"id":"claude","name":"Claude","status":"live","auth":"unauthenticated","planLabel":null,"rateLimits":null}]}
        """)
        let claude = try #require(providers.first)
        #expect(claude.summary == "Not signed in")
        #expect(claude.limitWindows.isEmpty)
        #expect(claude.isVisibleInMenu)
    }
}
