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
    @Published private(set) var relay: RelayStatusPayload?
    @Published private(set) var devices: [DeviceStatusPayload] = []
    @Published private(set) var status = "Starting"
    @Published private(set) var lastError: String?
    @Published private(set) var requiresApproval = false

    private let launchAgent = SMAppService.agent(
        plistName: RuntimeConstants.launchAgentPlistName
    )
    private var connection: NSXPCConnection?
    private var refreshTask: Task<Void, Never>?

    func start() {
        guard refreshTask == nil else {
            return
        }
        refreshTask = Task { [weak self] in
            guard let self else {
                return
            }
            await registerAgent()
            while !Task.isCancelled {
                await refresh()
                try? await Task.sleep(for: .seconds(2))
            }
        }
    }

    func refresh() async {
        do {
            let health = try await requestHealth()
            guard validatesRuntime(health) else {
                throw RuntimeConnectionError.untrustedRuntime
            }
            self.health = health
            status = health.phase == "running" ? "Running" : health.phase
            lastError = health.degradedReason ?? health.updateFailureReason
            writeUpdateE2EReport(health)
        } catch {
            disconnect()
            self.health = nil
            self.appServer = nil
            self.relay = nil
            self.devices = []
            status = "Unavailable"
            lastError = error.localizedDescription
            return
        }

        do {
            appServer = try await requestAppServer()
            if appServers.isEmpty {
                applyAppServerDiscovery(try await requestAppServers())
            }
            relay = try await requestRelayStatus()
            let deviceList = try await requestDevices()
            devices = deviceList.devices
        } catch {
            lastError = error.localizedDescription
        }
    }

    func prepareForUpdate(targetVersion: String) async throws {
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
        start()
    }

    func openLoginItemsSettings() {
        SMAppService.openSystemSettingsLoginItems()
    }

    func pairRelay(address: String, invitationJSON: String) async throws {
        relay = try await requestPairRelay(address: address, invitationJSON: invitationJSON)
        await refresh()
    }

    func discoverAppServers() async {
        guard !isDiscoveringAppServers else { return }
        isDiscoveringAppServers = true
        defer { isDiscoveringAppServers = false }
        do {
            applyAppServerDiscovery(try await requestAppServers())
        } catch {
            lastError = error.localizedDescription
        }
    }

    func selectAppServer(id: String) async throws {
        let selected = try await requestSelectAppServer(id: id)
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
        devices = []
        disconnect()
    }

    func startAppServer(id: String) async throws {
        let started = try await requestStartAppServer(id: id)
        appServers = appServers.map { server in
            guard server.id == started.id else { return server }
            return started
        }
        if started.selected {
            appServer = started
        }
    }

    func setRelayEnabled(_ enabled: Bool) async throws {
        relay = try await requestSetRelayEnabled(enabled)
        await refresh()
    }

    func createPairing() async throws -> PairingPayload {
        try await withCheckedThrowingContinuation { continuation in
            let gate = XPCReplyGate(continuation: continuation)
            guard let proxy = proxy(errorHandler: { gate.resume(with: .failure($0)) }) else {
                gate.resume(with: .failure(RuntimeConnectionError.invalidProxy))
                return
            }
            proxy.createPairing { payload, error in
                gate.resume(with: Self.result(payload: payload, error: error))
            }
        }
    }

    func revokeDevice(id: String) async throws {
        let removed: Bool = try await withCheckedThrowingContinuation { continuation in
            let gate = XPCReplyGate(continuation: continuation)
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
        await refresh()
    }

    private func registerAgent() async {
        do {
            switch launchAgent.status {
            case .enabled:
                requiresApproval = false
            case .requiresApproval:
                requiresApproval = true
                status = "Approval required"
            case .notRegistered, .notFound:
                try launchAgent.register()
                requiresApproval = launchAgent.status == .requiresApproval
            @unknown default:
                try launchAgent.register()
                requiresApproval = launchAgent.status == .requiresApproval
            }
        } catch {
            status = "Registration failed"
            lastError = error.localizedDescription
        }
    }

    private func requestHealth() async throws -> RuntimeHealthPayload {
        try await withCheckedThrowingContinuation { continuation in
            let gate = XPCReplyGate(continuation: continuation)
            gate.timeout(
                after: .seconds(5),
                with: RuntimeConnectionError.requestTimedOut
            )
            guard let proxy = proxy(errorHandler: { gate.resume(with: .failure($0)) }) else {
                gate.resume(with: .failure(RuntimeConnectionError.invalidProxy))
                return
            }
            proxy.health { payload, error in
                gate.resume(with: Self.result(payload: payload, error: error))
            }
        }
    }

    private func requestPrepareForUpdate(targetVersion: String) async throws
        -> RuntimeHealthPayload
    {
        try await withCheckedThrowingContinuation { continuation in
            let gate = XPCReplyGate(continuation: continuation)
            guard let proxy = proxy(errorHandler: { gate.resume(with: .failure($0)) }) else {
                gate.resume(with: .failure(RuntimeConnectionError.invalidProxy))
                return
            }
            proxy.prepareForUpdate(targetVersion: targetVersion) { payload, error in
                gate.resume(with: Self.result(payload: payload, error: error))
            }
        }
    }

    private func requestRelayStatus() async throws -> RelayStatusPayload {
        try await withCheckedThrowingContinuation { continuation in
            let gate = XPCReplyGate(continuation: continuation)
            guard let proxy = proxy(errorHandler: { gate.resume(with: .failure($0)) }) else {
                gate.resume(with: .failure(RuntimeConnectionError.invalidProxy))
                return
            }
            proxy.relayStatus { payload, error in
                gate.resume(with: Self.result(payload: payload, error: error))
            }
        }
    }

    private func requestAppServer() async throws -> AppServerPayload {
        try await withCheckedThrowingContinuation { continuation in
            let gate = XPCReplyGate(continuation: continuation)
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
        try await withCheckedThrowingContinuation { continuation in
            let gate = XPCReplyGate(continuation: continuation)
            gate.timeout(after: .seconds(8), with: RuntimeConnectionError.requestTimedOut)
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
        try await withCheckedThrowingContinuation { continuation in
            let gate = XPCReplyGate(continuation: continuation)
            gate.timeout(after: .seconds(8), with: RuntimeConnectionError.requestTimedOut)
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
        try await withCheckedThrowingContinuation { continuation in
            let gate = XPCReplyGate(continuation: continuation)
            gate.timeout(after: .seconds(30), with: RuntimeConnectionError.requestTimedOut)
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
    }

    private func requestDevices() async throws -> DeviceListPayload {
        try await withCheckedThrowingContinuation { continuation in
            let gate = XPCReplyGate(continuation: continuation)
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
        try await withCheckedThrowingContinuation { continuation in
            let gate = XPCReplyGate(continuation: continuation)
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
        try await withCheckedThrowingContinuation { continuation in
            let gate = XPCReplyGate(continuation: continuation)
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
        newConnection.invalidationHandler = { [weak self] in
            Task { @MainActor in
                self?.connection = nil
            }
        }
        newConnection.interruptionHandler = { [weak self] in
            Task { @MainActor in
                self?.connection = nil
            }
        }
        newConnection.resume()
        connection = newConnection
        return newConnection
    }

    private func disconnect() {
        connection?.invalidate()
        connection = nil
    }

    private func validatesRuntime(_ payload: RuntimeHealthPayload) -> Bool {
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

    var errorDescription: String? {
        switch self {
        case .emptyReply:
            "The runtime returned an empty XPC reply."
        case .invalidProxy:
            "The runtime XPC proxy is unavailable."
        case .requestTimedOut:
            "The runtime XPC health request timed out."
        case .untrustedRuntime:
            "The XPC peer is not the ad-hoc signed runtime inside this app bundle."
        case .updateCheckpointRejected:
            "The runtime did not persist the update checkpoint."
        case .deviceNotFound:
            "The device is no longer registered."
        }
    }
}
