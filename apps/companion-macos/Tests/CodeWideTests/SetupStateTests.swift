import CodeWideShared
import Foundation
import Testing
@testable import CodeWide

struct SetupStateTests {
    @Test func phoneStepRequiresAnExplicitConnectionChoice() {
        var snapshot = SetupSnapshot(macState: .ready)
        #expect(SetupStep.allCases == [.mac, .relay, .phone])
        #expect(snapshot.canNavigate(to: .relay))
        #expect(!snapshot.canNavigate(to: .phone))
        snapshot.hasChosenConnection = true
        #expect(snapshot.canNavigate(to: .phone))
        snapshot.macState = .helperUnavailable
        #expect(!snapshot.canNavigate(to: .relay))
        #expect(!snapshot.canNavigate(to: .phone))
        #expect(snapshot.canNavigate(to: .mac))
    }

    @Test func choosingDirectDoesNotRequireARelay() {
        let snapshot = SetupSnapshot(macState: .ready, route: .direct, hasChosenConnection: true)
        #expect(snapshot.relay == nil)
        #expect(snapshot.canNavigate(to: .phone))
    }

    @Test func setupNavigationCannotInterruptAProfileChange() {
        let snapshot = SetupSnapshot(macState: .ready, isWorking: true, hasChosenConnection: true)
        #expect(SetupStep.allCases.allSatisfy { !snapshot.canNavigate(to: $0) })
    }

    @Test func anAlreadyConnectedSingleProfileNeedsNoChoiceOrConfirmation() {
        var snapshot = SetupSnapshot(macState: .ready, profiles: [profile(available: true)])
        #expect(snapshot.canAdvancePastCodex)
        #expect(!snapshot.showsProfilePicker)
        snapshot.step = .relay
        #expect(!snapshot.canAdvancePastCodex)
        // Completing Codex still leaves the Direct/Relay decision to the user.
        #expect(!snapshot.canNavigate(to: .phone))
    }

    @Test func multipleProfilesRemainAnExplicitChoice() {
        let other = AppServerPayload(id: "work", displayName: "Work", codexHome: "/work",
                                     state: .available(version: "0.157.0"), selected: false)
        let snapshot = SetupSnapshot(macState: .ready, profiles: [profile(available: true), other])
        #expect(!snapshot.canAdvancePastCodex)
        #expect(snapshot.showsProfilePicker)
    }

    @Test func automaticAdvanceWaitsForDiscoveryAndRecovery() {
        var snapshot = SetupSnapshot(macState: .ready, profiles: [profile(available: true)])
        snapshot.isDiscovering = true
        #expect(!snapshot.canAdvancePastCodex)
        snapshot.isDiscovering = false
        snapshot.isWorking = true
        #expect(!snapshot.canAdvancePastCodex)
        snapshot.isWorking = false
        snapshot.error = "Discovery failed"
        #expect(!snapshot.canAdvancePastCodex)
        snapshot.error = nil
        for state: SetupMacState in [.checking, .helperUnavailable, .permissionRequired, .startCodex] {
            snapshot.macState = state
            #expect(!snapshot.canAdvancePastCodex)
            #expect(!snapshot.showsProfilePicker)
        }
    }

    @Test func anUnselectedSingleProfileRequiresConnectInsteadOfARadioChoice() {
        let snapshot = SetupSnapshot(macState: .chooseProfile,
                                     profiles: [profile(available: true, selected: false)])
        #expect(!snapshot.canAdvancePastCodex)
        #expect(!snapshot.showsProfilePicker)
        #expect(snapshot.profileToConnect?.id == "test")
        #expect(snapshot.canPerformPrimaryAction)
        let offline = SetupSnapshot(macState: .chooseProfile, profiles: [profile(available: false)])
        #expect(offline.profileToConnect == nil)
        #expect(!offline.canPerformPrimaryAction)
    }

    private var healthy: RuntimeHealthPayload {
        RuntimeHealthPayload(phase: "running", degradedReason: nil, appVersion: "0.4.0",
                            hostVersion: "0.4.0", coreVersion: "0.4.0", stateSchema: 1,
                            processID: 1, launchCount: 1, startedAtUnixMilliseconds: 1,
                            updateStatus: "none", updateFromVersion: nil,
                            updateTargetVersion: nil, updateFailureReason: nil,
                            hostExecutablePath: "/test/CodeWideRuntime")
    }

    private func profile(available: Bool, selected: Bool = true) -> AppServerPayload {
        AppServerPayload(id: "test", displayName: "Test", codexHome: "/test",
                         state: available ? .available(version: "0.157.0") : .unavailable(lastKnownVersion: nil),
                         selected: selected)
    }

    private func state(server: AppServerPayload? = nil, servers: [AppServerPayload] = [],
                       installation: CodexInstallationState? = nil,
                       discovering: Bool = false, discovered: Bool = true) -> SetupMacState {
        SetupMacState(health: healthy, server: server, servers: servers, installation: installation,
                      requiresApproval: false, runtimeStatus: "Running",
                      isDiscovering: discovering, hasDiscovered: discovered)
    }

    @Test func stoppedCodexOffersStartOnlyForAKnownProfile() {
        #expect(state(servers: [profile(available: false)], installation: .ready(installedVersion: "0.157.0")) == .startCodex)
        #expect(state(installation: .ready(installedVersion: "0.157.0")) == .retryDiscovery)
    }

    @Test func anotherAvailableProfileMustBeSelectedBeforeContinuing() {
        let result = state(server: profile(available: false),
                           servers: [profile(available: true, selected: false)])
        #expect(result == .chooseProfile)
        #expect(!result.canPerformPrimaryAction)
    }

    @Test func scanningDoesNotPrematurelyClaimCodexIsMissing() {
        #expect(state(installation: .notFound(minimumVersion: "0.157.0"), discovering: true) == .checking)
        #expect(state(discovered: false) == .checking)
        #expect(state(installation: .notFound(minimumVersion: "0.157.0")) == .installCodex)
    }

    @Test func permissionTakesPrecedenceOverOldConnectedState() {
        let result = SetupMacState(health: healthy, server: profile(available: true), servers: [],
                                   installation: nil, requiresApproval: true, runtimeStatus: "Running",
                                   isDiscovering: false, hasDiscovered: true)
        #expect(result == .permissionRequired)
    }

    @Test func helperFailureIsNotReportedAsMissingCodex() {
        let result = SetupMacState(health: nil, server: nil, servers: [], installation: nil,
                                   requiresApproval: false, runtimeStatus: "Unavailable",
                                   isDiscovering: false, hasDiscovered: true)
        #expect(result == .helperUnavailable)
    }

    @Test func unavailableOrExpiredPairingCannotBeDisplayedOrCopied() {
        let now = Date(timeIntervalSince1970: 100)
        var snapshot = SetupSnapshot(macState: .ready,
                                     endpoints: ["wss://192.0.2.1:8767/v1/sync"],
                                     selectedEndpoint: "wss://192.0.2.1:8767/v1/sync",
                                     pairing: PairingPayload(link: "fixture", expiresAtUnixMilliseconds: 101_000))
        #expect(snapshot.pairingIsUsable(at: now))
        #expect(!snapshot.pairingIsUsable(at: Date(timeIntervalSince1970: 101)))
        snapshot.selectedEndpoint = "wss://192.0.2.2:8767/v1/sync"
        #expect(!snapshot.pairingIsUsable(at: now))
        snapshot.selectedEndpoint = snapshot.endpoints.first
        snapshot.macState = .helperUnavailable
        #expect(!snapshot.pairingIsUsable(at: now))
        snapshot.macState = .ready
        snapshot.isCreatingPairing = true
        #expect(!snapshot.pairingIsUsable(at: now))
        snapshot.isCreatingPairing = false
        snapshot.pairingError = "Request failed"
        #expect(!snapshot.pairingIsUsable(at: now))
    }

    @Test func relayPairingWorksWithoutALocalNetworkAddress() throws {
        let relay = RelayStatusPayload(configured: true, enabled: true, connection: "online",
                                       publicEndpoint: "wss://relay.example.test:8780")
        let destination = try #require(PairingRoute.relay.destination(
            endpoint: nil, availableEndpoints: [], relay: relay))
        #expect(destination.directEndpoint == nil)
        var snapshot = SetupSnapshot(macState: .ready, route: .relay, relay: relay)
        #expect(snapshot.canPair)
        snapshot.route = .direct
        #expect(!snapshot.canPair)
    }

    @Test(arguments: ["disabled", "connecting", "reconnecting"])
    func unavailableRelayNeverSilentlyProducesADirectQRCode(connection: String) {
        let direct = "wss://192.0.2.1:8767/v1/sync"
        let relay = RelayStatusPayload(configured: true, enabled: connection != "disabled",
                                       connection: connection, publicEndpoint: "wss://relay.example.test:8780")
        let snapshot = SetupSnapshot(macState: .ready, endpoints: [direct], selectedEndpoint: direct,
                                     route: .relay, relay: relay)
        #expect(!snapshot.canPair)
        #expect(PairingRoute.relay.destination(endpoint: direct, availableEndpoints: [direct], relay: relay) == nil)
    }

    @Test func switchingRoutesInvalidatesThePreviousQRCodeRequest() throws {
        let direct = "wss://192.0.2.1:8767/v1/sync"
        let relay = RelayStatusPayload(configured: true, enabled: true, connection: "online",
                                       publicEndpoint: "wss://relay.example.test:8780")
        let local = try #require(PairingRoute.direct.destination(endpoint: direct, availableEndpoints: [direct], relay: relay))
        let remote = try #require(PairingRoute.relay.destination(endpoint: direct, availableEndpoints: [direct], relay: relay))
        #expect(local.directEndpoint == direct)
        #expect(remote.directEndpoint == nil)
        #expect(local.key != remote.key)
    }

    @Test(arguments: ["", "not-a-url", "ws://relay.example.test:8780"])
    func unusableRelayEndpointCannotCreateAPairing(endpoint: String) {
        let relay = RelayStatusPayload(configured: true, enabled: true, connection: "online", publicEndpoint: endpoint)
        #expect(PairingRoute.relay.destination(endpoint: nil, availableEndpoints: [], relay: relay) == nil)
    }
}
