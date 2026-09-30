import AppKit
import CodeWideShared
import SwiftUI

struct OnboardingFlow: View {
    @ObservedObject var runtime: RuntimeConnection
    let showRelaySetup: @MainActor () -> Void
    let finish: @MainActor () -> Void

    @State private var step: SetupStep = .mac
    @State private var hasFinishedInitialDiscovery = false
    @State private var allowsAutomaticAdvance = true
    @State private var route: PairingRoute = .direct
    @State private var hasChosenConnection = false
    @State private var actionError: String?
    @State private var isWorking = false
    @State private var pairing: PairingPayload?
    @State private var pairingError: String?
    @State private var pairingKey: String?
    @State private var pairingRequestID = UUID()
    @State private var isCreatingPairing = false

    var body: some View {
        SetupView(snapshot: snapshot, actions: SetupActions(
            primary: primaryAction,
            back: { move(to: step == .phone ? .relay : .mac) },
            finish: finish,
            scan: scan,
            selectProfile: selectProfile,
            selectEndpoint: { runtime.pairingEndpoint = $0 },
            newPairing: { Task { await createPairing() } },
            copyPairing: copyPairing,
            navigate: move,
            useDirect: { chooseConnection(.direct) },
            setupRelay: showRelaySetup,
            enableRelay: { runAction { try await runtime.setRelayEnabled(true) } }
        ))
        .task {
            await runtime.discoverAppServers()
            guard !Task.isCancelled else { return }
            hasFinishedInitialDiscovery = true
        }
        .onChange(of: shouldAdvancePastCodex, initial: true) { _, shouldAdvance in
            if shouldAdvance { move(to: .relay) }
        }
        .task(id: pairingRequestKey) {
            guard pairingRequestKey != nil else {
                pairingRequestID = UUID()
                pairing = nil
                pairingKey = nil
                pairingError = nil
                isCreatingPairing = false
                return
            }
            await createPairing()
        }
    }

    private var shouldAdvancePastCodex: Bool {
        hasFinishedInitialDiscovery && allowsAutomaticAdvance && snapshot.canAdvancePastCodex
    }

    private var macState: SetupMacState {
        SetupMacState(
            health: runtime.health, server: runtime.appServer, servers: runtime.appServers,
            installation: runtime.codexInstallation, requiresApproval: runtime.requiresApproval,
            runtimeStatus: runtime.status, isDiscovering: runtime.isDiscoveringAppServers,
            hasDiscovered: runtime.hasDiscoveredAppServers
        )
    }

    private var snapshot: SetupSnapshot {
        var value = SetupSnapshot()
        value.step = step
        value.macState = macState
        value.profiles = runtime.appServers
        value.installation = runtime.codexInstallation
        value.endpoints = runtime.directAccess?.endpoints ?? []
        value.selectedEndpoint = runtime.pairingEndpoint
        value.device = runtime.devices.first
        // Hide the old QR synchronously when its endpoint or profile changes.
        value.pairing = pairingKey == pairingRequestKey ? pairing : nil
        value.pairingError = pairingKey == pairingRequestKey ? pairingError : nil
        value.error = actionError ?? runtime.lastError
        value.isWorking = isWorking
        value.isDiscovering = runtime.isDiscoveringAppServers
        value.isCreatingPairing = isCreatingPairing || pairingRequestKey != nil && pairingKey != pairingRequestKey
        value.route = route
        value.relay = runtime.relay
        value.hasChosenConnection = hasChosenConnection
        return value
    }

    private var pairingRequestKey: String? {
        guard step == .phone, hasChosenConnection, macState == .ready, runtime.devices.isEmpty,
              let destination = route.destination(endpoint: runtime.pairingEndpoint,
                                                  availableEndpoints: runtime.directAccess?.endpoints ?? [],
                                                  relay: runtime.relay) else { return nil }
        return "\(runtime.health?.processID ?? 0):\(runtime.appServer?.id ?? ""):\(destination.key)"
    }

    private func primaryAction() {
        guard !isWorking else { return }
        if step == .relay {
            if macState != .ready { move(to: .mac) }
            else if snapshot.relayIsReady { chooseConnection(.relay) }
            else if runtime.relay?.configured == true && runtime.relay?.enabled == false {
                runAction { try await runtime.setRelayEnabled(true) }
            } else { showRelaySetup() }
            return
        }
        if step == .phone {
            if macState != .ready { move(to: .mac) }
            else if !runtime.devices.isEmpty { finish() }
            else { scan() }
            return
        }
        switch macState {
        case .ready: move(to: .relay)
        case .permissionRequired: runtime.openLoginItemsSettings()
        case .helperUnavailable, .retryDiscovery: scan()
        case .startCodex:
            guard let profile = runtime.appServers.first(where: { $0.selected }) else { return }
            runAction {
                try await runtime.startAppServer(id: profile.id)
                await runtime.refresh()
                await runtime.discoverAppServers()
            }
        case .installCodex, .updateCodex:
            if let url = URL(string: "https://developers.openai.com/codex/cli") { NSWorkspace.shared.open(url) }
        case .chooseProfile:
            if let profile = snapshot.profileToConnect { selectProfile(profile) }
        case .checking: break
        }
    }

    private func move(to destination: SetupStep) {
        guard destination != step, snapshot.canNavigate(to: destination) else { return }
        // Returning to Codex is deliberate; refreshes must not send the user forward again.
        allowsAutomaticAdvance = false
        step = destination
        actionError = nil
    }

    private func chooseConnection(_ choice: PairingRoute) {
        guard macState == .ready, !isWorking, choice == .direct || snapshot.relayIsReady else { return }
        route = choice
        hasChosenConnection = true
        move(to: .phone)
    }

    private func scan() {
        runAction {
            await runtime.refresh()
            await runtime.discoverAppServers()
        }
    }

    private func selectProfile(_ profile: AppServerPayload) {
        guard profile.state.isAvailable, !profile.selected else { return }
        runAction {
            try await runtime.selectAppServer(id: profile.id)
            await runtime.refresh()
            await runtime.discoverAppServers()
        }
    }

    private func runAction(_ action: @escaping @MainActor () async throws -> Void) {
        guard !isWorking else { return }
        isWorking = true
        actionError = nil
        Task {
            defer { isWorking = false }
            do { try await action() }
            catch { actionError = error.localizedDescription }
        }
    }

    private func createPairing() async {
        guard let requestKey = pairingRequestKey else { return }
        let requestID = UUID()
        pairingRequestID = requestID
        pairingKey = requestKey
        pairing = nil
        pairingError = nil
        isCreatingPairing = true
        defer { if requestID == pairingRequestID { isCreatingPairing = false } }
        do {
            let result = try await runtime.createPairing(route: route)
            guard requestID == pairingRequestID, requestKey == pairingRequestKey,
                  !Task.isCancelled else { return }
            pairing = result
        } catch is CancellationError {
            // A changed step, profile or address invalidates the previous request.
        } catch {
            guard requestID == pairingRequestID, requestKey == pairingRequestKey,
                  !Task.isCancelled else { return }
            pairingError = error.localizedDescription
        }
    }

    private func copyPairing() {
        guard snapshot.pairingIsUsable(at: .now), let pairing = snapshot.pairing else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(pairing.link, forType: .string)
    }
}
