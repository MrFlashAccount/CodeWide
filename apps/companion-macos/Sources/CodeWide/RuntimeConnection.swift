import CodeWideShared
import Combine
import Foundation
import ServiceManagement

@MainActor
final class RuntimeConnection: ObservableObject {
    @Published private(set) var health: RuntimeHealthPayload?
    @Published private(set) var appServer: AppServerPayload?
    @Published private(set) var appServers: [AppServerPayload] = []
    @Published private(set) var codexInstallation: CodexInstallationState?
    @Published private(set) var isDiscoveringAppServers = false
    @Published private(set) var hasDiscoveredAppServers = false
    @Published private(set) var relay: RelayStatusPayload?
    @Published private(set) var relayUpdate: RelayUpdateView?
    @Published private(set) var relayUpdateError: String?
    @Published private(set) var isRelayUpdateWorking = false
    @Published private(set) var directAccess: DirectAccessPayload?
    @Published var pairingEndpoint: String?
    @Published private(set) var devices: [DeviceStatusPayload] = []
    @Published private(set) var status = "Starting"
    @Published private(set) var lastError: String?
    @Published private(set) var requiresApproval = false

    private let launchAgent: any RuntimeAgentService
    private let proxyProvider: ((@escaping @Sendable (Error) -> Void) -> RuntimeXPCProtocol?)?
    private let runtimeValidator: ((RuntimeHealthPayload) -> Bool)?
    private let reportsUpdateHealth: Bool
    private let registration: RuntimeRegistration?
    private var registrationPrepared = false
    private var registrationRecoveryUsed = false
    private var connection: NSXPCConnection?
    private var refreshTask: Task<Void, Never>?
    private var connectionID = UUID()
    private var refreshInProgress = false
    private var preparingUpdate = false
    private var stateRevision = 0

    init(
        launchAgent: any RuntimeAgentService = SMAppService.agent(
            plistName: RuntimeConstants.launchAgentPlistName
        ),
        proxyProvider: ((@escaping @Sendable (Error) -> Void) -> RuntimeXPCProtocol?)? = nil,
        runtimeValidator: ((RuntimeHealthPayload) -> Bool)? = nil,
        reportsUpdateHealth: Bool = true,
        registration: RuntimeRegistration? = RuntimeRegistration.current()
    ) {
        self.launchAgent = launchAgent
        self.proxyProvider = proxyProvider
        self.runtimeValidator = runtimeValidator
        self.reportsUpdateHealth = reportsUpdateHealth
        self.registration = registration
    }

    func start() {
        guard refreshTask == nil else {
            return
        }
        refreshTask = Task { [weak self] in
            guard let self else {
                return
            }
            while !Task.isCancelled {
                await refresh()
                try? await Task.sleep(for: .seconds(2))
            }
        }
    }

    func refresh() async {
        guard !refreshInProgress, !preparingUpdate else { return }
        refreshInProgress = true
        defer { refreshInProgress = false }
        guard await registerAgent() else { return }
        let revision = stateRevision
        do {
            let health = try await requestHealth()
            guard revision == stateRevision, !Task.isCancelled else { return }
            guard validatesRuntime(health) else {
                throw RuntimeConnectionError.untrustedRuntime
            }
            self.health = health
            registration?.confirmHealthyRuntime()
            status = health.phase == "running" ? "Running" : health.phase
            lastError = health.degradedReason ?? health.updateFailureReason
            if reportsUpdateHealth { writeUpdateE2EReport(health) }
        } catch {
            guard revision == stateRevision, !Task.isCancelled else { return }
            recoverUnconfirmedRegistration(after: error)
            disconnect()
            self.health = nil
            self.directAccess = nil
            self.appServer = nil
            self.relay = nil
            self.relayUpdate = nil
            self.devices = []
            status = "Unavailable"
            lastError = error.localizedDescription
            return
        }

        do {
            let server = try await requestAppServer()
            let direct = try await requestDirectAccess()
            let relayStatus = try await requestRelayStatus()
            let deviceList = try await requestDevices()
            guard revision == stateRevision, !Task.isCancelled else { return }
            appServer = server
            directAccess = direct
            if !direct.endpoints.contains(pairingEndpoint ?? "") {
                pairingEndpoint = direct.endpoints.first
            }
            relay = relayStatus
            if relayStatus.configured {
                await refreshRelayUpdateSilently()
            } else {
                relayUpdate = nil
                relayUpdateError = nil
            }
            devices = deviceList.devices
            if appServers.isEmpty {
                await discoverAppServers()
            }
        } catch {
            guard revision == stateRevision, !Task.isCancelled else { return }
            disconnect()
            health = nil
            directAccess = nil
            appServer = nil
            relay = nil
            relayUpdate = nil
            devices = []
            status = "Unavailable"
            lastError = error.localizedDescription
        }
    }

    func prepareForUpdate(targetVersion: String) async throws {
        preparingUpdate = true
        stateRevision += 1
        refreshTask?.cancel()
        refreshTask = nil
        do {
            try await checkpointForUpdate(targetVersion: targetVersion)
        } catch {
            preparingUpdate = false
            start()
            throw error
        }
    }

    func stopForGuardianUpdate() async throws {
        preparingUpdate = true
        stateRevision += 1
        refreshTask?.cancel()
        refreshTask = nil
        do {
            guard try await requestStopForGuardianUpdate() else {
                throw RuntimeConnectionError.updateCheckpointRejected
            }
            disconnect()
        } catch {
            preparingUpdate = false
            start()
            throw error
        }
    }

    private func checkpointForUpdate(targetVersion: String) async throws {
        let payload = try await requestPrepareForUpdate(targetVersion: targetVersion)
        guard payload.updateStatus == "prepared", validatesRuntime(payload) else {
            throw RuntimeConnectionError.updateCheckpointRejected
        }
        health = payload
        status = "Preparing update"
        refreshTask?.cancel()
        refreshTask = nil
        disconnect()
    }

    func resumeAfterUpdateFailure() {
        preparingUpdate = false
        start()
    }

    func openLoginItemsSettings() {
        SMAppService.openSystemSettingsLoginItems()
    }

    func pairRelay(address: String, invitationJSON: String) async throws {
        let address = try RelayAddress.normalized(address)
        let paired = try await requestPairRelay(address: address, invitationJSON: invitationJSON)
        stateRevision += 1
        relay = paired
        await refresh()
    }

    func beginRelayEnrollment(address: String) async throws -> RelayEnrollmentPayload {
        let address = try RelayAddress.normalized(address)
        return try await XPCReplyGate.perform { gate in
            guard let proxy = proxy(errorHandler: { gate.resume(with: .failure($0)) }) else {
                gate.resume(with: .failure(RuntimeConnectionError.invalidProxy))
                return
            }
            proxy.beginRelayEnrollment(address: address) { payload, error in
                gate.resume(with: Self.result(payload: payload, error: error))
            }
        }
    }

    func relayEnrollmentStatus(id: String) async throws -> RelayEnrollmentPayload {
        try await XPCReplyGate.perform { gate in
            guard let proxy = proxy(errorHandler: { gate.resume(with: .failure($0)) }) else {
                gate.resume(with: .failure(RuntimeConnectionError.invalidProxy))
                return
            }
            proxy.relayEnrollmentStatus(id: id) { payload, error in
                gate.resume(with: Self.result(payload: payload, error: error))
            }
        }
    }

    func cancelRelayEnrollment(id: String) async throws {
        let _: Bool = try await XPCReplyGate.perform { gate in
            guard let proxy = proxy(errorHandler: { gate.resume(with: .failure($0)) }) else {
                gate.resume(with: .failure(RuntimeConnectionError.invalidProxy))
                return
            }
            proxy.cancelRelayEnrollment(id: id) { cancelled, error in
                if let error { gate.resume(with: .failure(error)) }
                else { gate.resume(with: .success(cancelled)) }
            }
        }
    }

    func relayEnrollmentCompleted() async {
        stateRevision += 1
        await refresh()
    }

    func discoverAppServers() async {
        guard !isDiscoveringAppServers else { return }
        isDiscoveringAppServers = true
        hasDiscoveredAppServers = false
        let revision = stateRevision
        defer { isDiscoveringAppServers = false }
        if health == nil {
            await refresh()
        }
        guard health != nil, revision == stateRevision, !Task.isCancelled else { return }
        do {
            let payload = try await requestAppServers()
            guard revision == stateRevision, !Task.isCancelled else { return }
            applyAppServerDiscovery(payload)
        } catch {
            guard revision == stateRevision, !Task.isCancelled else { return }
            lastError = error.localizedDescription
        }
    }

    func selectAppServer(id: String) async throws {
        let selected = try await requestSelectAppServer(id: id)
        stateRevision += 1
        appServer = selected
        appServers = appServers.map { server in
            AppServerPayload(
                id: server.id,
                displayName: server.displayName,
                codexHome: server.codexHome,
                state: server.state,
                selected: server.id == selected.id
            )
        }
        status = "Switching App Server"
        health = nil
        relay = nil
        relayUpdate = nil
        directAccess = nil
        pairingEndpoint = nil
        devices = []
        disconnect()
    }

    func startAppServer(id: String) async throws {
        let started = try await requestStartAppServer(id: id)
        stateRevision += 1
        appServers = appServers.map { server in
            guard server.id == started.id else { return server }
            return started
        }
        if started.selected {
            appServer = started
        }
    }

    func setRelayEnabled(_ enabled: Bool) async throws {
        let updated = try await requestSetRelayEnabled(enabled)
        stateRevision += 1
        relay = updated
        await refresh()
    }

    func checkRelayUpdate() async throws {
        guard !isRelayUpdateWorking else { return }
        isRelayUpdateWorking = true
        relayUpdateError = nil
        defer { isRelayUpdateWorking = false }
        do {
            relayUpdate = try RelayUpdateCodec.status(try await requestCheckRelayUpdate())
        } catch {
            relayUpdateError = error.localizedDescription
            throw error
        }
    }

    func applyRelayUpdate() async throws {
        guard !isRelayUpdateWorking,
              let target = relayUpdate?.availableTarget
        else { return }
        isRelayUpdateWorking = true
        relayUpdateError = nil
        defer { isRelayUpdateWorking = false }
        do {
            _ = try RelayUpdateCodec.accepted(
                try await requestApplyRelayUpdate(
                    targetFingerprint: target.targetFingerprint,
                    idempotencyKey: "macos-\(UUID().uuidString.lowercased())"
                )
            )
            await refreshRelayUpdateSilently()
        } catch {
            relayUpdateError = error.localizedDescription
            throw error
        }
    }

    private func refreshRelayUpdateSilently() async {
        do {
            let update = try RelayUpdateCodec.status(try await requestRelayUpdateStatus())
            relayUpdate = update
            relayUpdateError = update.failureMessage
        } catch {
            // An old Relay and the short restart window do not make the local
            // Companion unavailable. Explicit actions still surface failures.
        }
    }

    var preferredPairingRoute: PairingRoute {
        PairingRoute.relay.destination(
            endpoint: nil,
            availableEndpoints: [],
            relay: relay
        ) == nil ? .direct : .relay
    }

    func createPairing(route requestedRoute: PairingRoute? = nil) async throws -> PairingPayload {
        let route = requestedRoute ?? preferredPairingRoute
        guard let destination = route.destination(endpoint: pairingEndpoint,
                                                  availableEndpoints: directAccess?.endpoints ?? [],
                                                  relay: relay) else {
            throw route == .relay ? RuntimeConnectionError.relayUnavailable : .noNetworkAddress
        }
        return try await XPCReplyGate.perform { gate in
            guard let proxy = proxy(errorHandler: { gate.resume(with: .failure($0)) }) else {
                gate.resume(with: .failure(RuntimeConnectionError.invalidProxy))
                return
            }
            proxy.createPairing(directEndpoint: destination.directEndpoint) { payload, error in
                gate.resume(with: Self.result(payload: payload, error: error))
            }
        }
    }

    func revokeDevice(id: String) async throws {
        let removed: Bool = try await XPCReplyGate.perform { gate in
            guard let proxy = proxy(errorHandler: { gate.resume(with: .failure($0)) }) else {
                gate.resume(with: .failure(RuntimeConnectionError.invalidProxy))
                return
            }
            proxy.revokeDevice(id: id) { removed, error in
                if let error {
                    gate.resume(with: .failure(error))
                } else {
                    gate.resume(with: .success(removed))
                }
            }
        }
        guard removed else {
            throw RuntimeConnectionError.deviceNotFound
        }
        stateRevision += 1
        devices.removeAll { $0.id == id }
        await refresh()
    }

    private func registerAgent() async -> Bool {
        do {
            if launchAgent.status == .enabled,
               !registrationPrepared, registration?.needsUpdate == true {
                disconnect()
                // Await unregistration before replacing a changed registration.
                // The first new launch may still fail its macOS spawn constraint;
                // an unconfirmed transport failure permits one fresh registration.
                try await launchAgent.unregister()
                try launchAgent.register()
                registrationPrepared = true
            }
            if launchAgent.status == .notRegistered || launchAgent.status == .notFound {
                try launchAgent.register()
                registrationPrepared = true
            }
            requiresApproval = launchAgent.status == .requiresApproval
            guard launchAgent.status == .enabled else {
                disconnect()
                health = nil
                directAccess = nil
                appServer = nil
                relay = nil
                relayUpdate = nil
                devices = []
                status = requiresApproval ? "Approval required" : "Unavailable"
                lastError = requiresApproval
                    ? "Allow CodeWide in Login Items Settings to start the Companion."
                    : "The Companion background service is unavailable."
                return false
            }
            return true
        } catch {
            disconnect()
            health = nil
            directAccess = nil
            appServer = nil
            relay = nil
            relayUpdate = nil
            devices = []
            status = "Registration failed"
            lastError = error.localizedDescription
            return false
        }
    }

    private func recoverUnconfirmedRegistration(after error: Error) {
        guard registrationPrepared, registration?.needsUpdate == true,
              !registrationRecoveryUsed else { return }
        let transportFailure: Bool
        if let failure = error as? RuntimeConnectionError {
            switch failure {
            case .requestTimedOut, .invalidProxy: transportFailure = true
            default: transportFailure = false
            }
        } else {
            let failure = error as NSError
            transportFailure = failure.domain == NSCocoaErrorDomain && [
                CocoaError.Code.xpcConnectionInterrupted.rawValue,
                CocoaError.Code.xpcConnectionInvalid.rawValue,
            ].contains(failure.code)
        }
        guard transportFailure else { return }
        registrationRecoveryUsed = true
        registrationPrepared = false
    }

    private func requestHealth() async throws -> RuntimeHealthPayload {
        try await XPCReplyGate.perform { gate in
            guard let proxy = proxy(errorHandler: { gate.resume(with: .failure($0)) }) else {
                gate.resume(with: .failure(RuntimeConnectionError.invalidProxy))
                return
            }
            proxy.health { payload, error in
                gate.resume(with: Self.result(payload: payload, error: error))
            }
        }
    }

    private func requestDirectAccess() async throws -> DirectAccessPayload {
        try await XPCReplyGate.perform { gate in
            guard let proxy = proxy(errorHandler: { gate.resume(with: .failure($0)) }) else {
                gate.resume(with: .failure(RuntimeConnectionError.invalidProxy))
                return
            }
            proxy.directAccess { payload, error in
                gate.resume(with: Self.result(payload: payload, error: error))
            }
        }
    }

    private func requestPrepareForUpdate(targetVersion: String) async throws
        -> RuntimeHealthPayload
    {
        try await XPCReplyGate.perform { gate in
            guard let proxy = proxy(errorHandler: { gate.resume(with: .failure($0)) }) else {
                gate.resume(with: .failure(RuntimeConnectionError.invalidProxy))
                return
            }
            proxy.prepareForUpdate(targetVersion: targetVersion) { payload, error in
                gate.resume(with: Self.result(payload: payload, error: error))
            }
        }
    }

    private func requestStopForGuardianUpdate() async throws -> Bool {
        try await XPCReplyGate.perform { gate in
            guard let proxy = proxy(errorHandler: { gate.resume(with: .failure($0)) }) else {
                gate.resume(with: .failure(RuntimeConnectionError.invalidProxy))
                return
            }
            proxy.stopForGuardianUpdate { stopped, error in
                if let error {
                    gate.resume(with: .failure(error))
                } else {
                    gate.resume(with: .success(stopped))
                }
            }
        }
    }

    private func requestRelayStatus() async throws -> RelayStatusPayload {
        try await XPCReplyGate.perform { gate in
            guard let proxy = proxy(errorHandler: { gate.resume(with: .failure($0)) }) else {
                gate.resume(with: .failure(RuntimeConnectionError.invalidProxy))
                return
            }
            proxy.relayStatus { payload, error in
                gate.resume(with: Self.result(payload: payload, error: error))
            }
        }
    }

    private func requestRelayUpdateStatus() async throws -> String {
        try await XPCReplyGate.perform { gate in
            guard let proxy = proxy(errorHandler: { gate.resume(with: .failure($0)) }) else {
                gate.resume(with: .failure(RuntimeConnectionError.invalidProxy))
                return
            }
            proxy.relayUpdateStatus { payload, error in
                gate.resume(with: Self.result(payload: payload, error: error))
            }
        }
    }

    private func requestCheckRelayUpdate() async throws -> String {
        try await XPCReplyGate.perform(timeout: .seconds(30)) { gate in
            guard let proxy = proxy(errorHandler: { gate.resume(with: .failure($0)) }) else {
                gate.resume(with: .failure(RuntimeConnectionError.invalidProxy))
                return
            }
            proxy.checkRelayUpdate { payload, error in
                gate.resume(with: Self.result(payload: payload, error: error))
            }
        }
    }

    private func requestApplyRelayUpdate(
        targetFingerprint: String,
        idempotencyKey: String
    ) async throws -> String {
        try await XPCReplyGate.perform(timeout: .seconds(30)) { gate in
            guard let proxy = proxy(errorHandler: { gate.resume(with: .failure($0)) }) else {
                gate.resume(with: .failure(RuntimeConnectionError.invalidProxy))
                return
            }
            proxy.applyRelayUpdate(
                targetFingerprint: targetFingerprint,
                idempotencyKey: idempotencyKey
            ) { payload, error in
                gate.resume(with: Self.result(payload: payload, error: error))
            }
        }
    }

    private func requestAppServer() async throws -> AppServerPayload {
        try await XPCReplyGate.perform { gate in
            guard let proxy = proxy(errorHandler: { gate.resume(with: .failure($0)) }) else {
                gate.resume(with: .failure(RuntimeConnectionError.invalidProxy))
                return
            }
            proxy.appServer { payload, error in
                gate.resume(with: Self.result(payload: payload, error: error))
            }
        }
    }

    private func requestAppServers() async throws -> AppServerListPayload {
        try await XPCReplyGate.perform(timeout: .seconds(30)) { gate in
            guard let proxy = proxy(errorHandler: { gate.resume(with: .failure($0)) }) else {
                gate.resume(with: .failure(RuntimeConnectionError.invalidProxy))
                return
            }
            proxy.discoverAppServers { payload, error in
                gate.resume(with: Self.result(payload: payload, error: error))
            }
        }
    }

    private func requestSelectAppServer(id: String) async throws -> AppServerPayload {
        try await XPCReplyGate.perform(timeout: .seconds(30)) { gate in
            guard let proxy = proxy(errorHandler: { gate.resume(with: .failure($0)) }) else {
                gate.resume(with: .failure(RuntimeConnectionError.invalidProxy))
                return
            }
            proxy.selectAppServer(id: id) { payload, error in
                gate.resume(with: Self.result(payload: payload, error: error))
            }
        }
    }

    private func requestStartAppServer(id: String) async throws -> AppServerPayload {
        try await XPCReplyGate.perform(timeout: .seconds(30)) { gate in
            guard let proxy = proxy(errorHandler: { gate.resume(with: .failure($0)) }) else {
                gate.resume(with: .failure(RuntimeConnectionError.invalidProxy))
                return
            }
            proxy.startAppServer(id: id) { payload, error in
                gate.resume(with: Self.result(payload: payload, error: error))
            }
        }
    }

    private func applyAppServerDiscovery(_ payload: AppServerListPayload) {
        appServers = payload.servers
        codexInstallation = payload.codexInstallation.state
        hasDiscoveredAppServers = true
    }

    private func requestDevices() async throws -> DeviceListPayload {
        try await XPCReplyGate.perform { gate in
            guard let proxy = proxy(errorHandler: { gate.resume(with: .failure($0)) }) else {
                gate.resume(with: .failure(RuntimeConnectionError.invalidProxy))
                return
            }
            proxy.devices { payload, error in
                gate.resume(with: Self.result(payload: payload, error: error))
            }
        }
    }

    private func requestPairRelay(
        address: String,
        invitationJSON: String
    ) async throws -> RelayStatusPayload {
        try await XPCReplyGate.perform(timeout: .seconds(30)) { gate in
            guard let proxy = proxy(errorHandler: { gate.resume(with: .failure($0)) }) else {
                gate.resume(with: .failure(RuntimeConnectionError.invalidProxy))
                return
            }
            proxy.pairRelay(address: address, invitationJSON: invitationJSON) { payload, error in
                gate.resume(with: Self.result(payload: payload, error: error))
            }
        }
    }

    private func requestSetRelayEnabled(_ enabled: Bool) async throws -> RelayStatusPayload {
        try await XPCReplyGate.perform { gate in
            guard let proxy = proxy(errorHandler: { gate.resume(with: .failure($0)) }) else {
                gate.resume(with: .failure(RuntimeConnectionError.invalidProxy))
                return
            }
            proxy.setRelayEnabled(enabled) { payload, error in
                gate.resume(with: Self.result(payload: payload, error: error))
            }
        }
    }

    private func proxy(
        errorHandler: @escaping @Sendable (Error) -> Void
    ) -> RuntimeXPCProtocol? {
        if let proxyProvider {
            return proxyProvider(errorHandler)
        }
        let connection = activeConnection()
        return connection.remoteObjectProxyWithErrorHandler(errorHandler)
            as? RuntimeXPCProtocol
    }

    private func activeConnection() -> NSXPCConnection {
        if let connection {
            return connection
        }
        let newConnection = NSXPCConnection(
            machServiceName: RuntimeConstants.machServiceName,
            options: []
        )
        newConnection.setCodeSigningRequirement(
            RuntimeConstants.runtimeCodeSigningRequirement
        )
        newConnection.remoteObjectInterface = makeRuntimeXPCInterface()
        let id = UUID()
        connectionID = id
        let disconnected: @Sendable () -> Void = { [weak self] in
            Task { @MainActor in
                guard let self, self.connectionID == id else { return }
                self.disconnect()
            }
        }
        newConnection.invalidationHandler = disconnected
        newConnection.interruptionHandler = disconnected
        newConnection.resume()
        connection = newConnection
        return newConnection
    }

    private func disconnect() {
        let previous = connection
        connection = nil
        connectionID = UUID()
        previous?.invalidate()
    }

    private func validatesRuntime(_ payload: RuntimeHealthPayload) -> Bool {
        if let runtimeValidator { return runtimeValidator(payload) }
        let executableURL = URL(fileURLWithPath: payload.hostExecutablePath)
        guard AdHocPeerValidator.acceptsRuntimeExecutable(
            executableURL,
            appBundleURL: Bundle.main.bundleURL
        ) else {
            return false
        }
        let appVersion = Bundle.main.object(
            forInfoDictionaryKey: "CFBundleShortVersionString"
        ) as? String
        return payload.appVersion == appVersion && payload.hostVersion == appVersion
    }

    private func writeUpdateE2EReport(_ payload: RuntimeHealthPayload) {
        let markerURL = RuntimeConstants.stateDirectory.appending(
            path: "update-e2e.enabled",
            directoryHint: .notDirectory
        )
        guard FileManager.default.fileExists(atPath: markerURL.path) else {
            return
        }
        let reportURL = RuntimeConstants.stateDirectory.appending(
            path: "update-e2e-health.json",
            directoryHint: .notDirectory
        )
        var report: [String: Any] = [
            "phase": payload.phase,
            "appVersion": payload.appVersion,
            "hostVersion": payload.hostVersion,
            "coreVersion": payload.coreVersion,
            "stateSchema": payload.stateSchema,
            "appProcessId": ProcessInfo.processInfo.processIdentifier,
            "processId": payload.processID,
            "launchCount": payload.launchCount,
            "updateStatus": payload.updateStatus,
        ]
        report["updateFromVersion"] = payload.updateFromVersion
        report["updateTargetVersion"] = payload.updateTargetVersion
        report["degradedReason"] = payload.degradedReason
        report["updateFailureReason"] = payload.updateFailureReason
        // Opt-in smoke evidence uses the same state owner rendered by Setup;
        // no profile paths, pairing links, credentials or user content are exported.
        let setup = SetupMacState(
            health: health, server: appServer, servers: appServers,
            installation: codexInstallation, requiresApproval: requiresApproval,
            runtimeStatus: status, isDiscovering: isDiscoveringAppServers,
            hasDiscovered: hasDiscoveredAppServers
        )
        report["codexNotFound"] = {
            if case .some(.notFound) = codexInstallation { return true }
            return false
        }()
        report["setupTitle"] = setup.title
        report["setupExplanation"] = setup.explanation
        report["setupAction"] = setup.primaryTitle
        report["setupActionEnabled"] = setup.canPerformPrimaryAction
        do {
            let data = try JSONSerialization.data(withJSONObject: report, options: [.sortedKeys])
            try data.write(to: reportURL, options: [.atomic])
        } catch {
            lastError = "Update E2E report failed: \(error.localizedDescription)"
        }
    }

    nonisolated private static func result<Payload>(
        payload: Payload?,
        error: NSError?
    ) -> Result<Payload, Error> {
        if let error {
            return .failure(error)
        }
        guard let payload else {
            return .failure(RuntimeConnectionError.emptyReply)
        }
        return .success(payload)
    }
}

enum RuntimeConnectionError: LocalizedError {
    case emptyReply
    case invalidProxy
    case requestTimedOut
    case untrustedRuntime
    case updateCheckpointRejected
    case deviceNotFound
    case noNetworkAddress
    case relayUnavailable

    var errorDescription: String? {
        switch self {
        case .emptyReply:
            "The runtime returned an empty XPC reply."
        case .invalidProxy:
            "The runtime XPC proxy is unavailable."
        case .requestTimedOut:
            "The Companion did not respond in time. Try again."
        case .untrustedRuntime:
            "The XPC peer is not the ad-hoc signed runtime inside this app bundle."
        case .updateCheckpointRejected:
            "The runtime did not persist the update checkpoint."
        case .deviceNotFound:
            "The device is no longer registered."
        case .noNetworkAddress:
            "Connect this Mac to a network before adding a client."
        case .relayUnavailable:
            "Connect a Relay before creating a Relay QR code."
        }
    }
}

@MainActor
protocol RuntimeAgentService {
    var status: SMAppService.Status { get }
    func register() throws
    func unregister() async throws
}

extension SMAppService: RuntimeAgentService {}
