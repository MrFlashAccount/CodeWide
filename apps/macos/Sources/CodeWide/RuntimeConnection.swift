import CodeWideShared
import Combine
import Foundation
import ServiceManagement

@MainActor
final class RuntimeConnection: ObservableObject {
    @Published private(set) var health: RuntimeHealthPayload?
    @Published private(set) var status = "Starting"
    @Published private(set) var lastError: String?
    @Published private(set) var requiresApproval = false

    private let launchAgent = SMAppService.agent(
        plistName: RuntimeConstants.launchAgentPlistName
    )
    private var connection: NSXPCConnection?
    private var refreshTask: Task<Void, Never>?

    init() {
        if let reportPath = ProcessInfo.processInfo.environment[
            "CODEWIDE_UPDATE_E2E_REPORT_PATH"
        ] {
            UserDefaults.standard.set(reportPath, forKey: "CodeWideUpdateE2EReportPath")
        }
    }

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
            let payload = try await requestHealth()
            guard validatesRuntime(payload) else {
                throw RuntimeConnectionError.untrustedRuntime
            }
            health = payload
            status = payload.phase == "running" ? "Running" : payload.phase
            lastError = payload.degradedReason ?? payload.updateFailureReason
            writeUpdateE2EReport(payload)
        } catch {
            disconnect()
            health = nil
            status = "Unavailable"
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
        guard
            let path = UserDefaults.standard.string(forKey: "CodeWideUpdateE2EReportPath"),
            !path.isEmpty
        else {
            return
        }
        var report: [String: Any] = [
            "appVersion": payload.appVersion,
            "hostVersion": payload.hostVersion,
            "coreVersion": payload.coreVersion,
            "stateSchema": payload.stateSchema,
            "processId": payload.processID,
            "launchCount": payload.launchCount,
            "updateStatus": payload.updateStatus,
        ]
        report["updateFromVersion"] = payload.updateFromVersion
        report["updateTargetVersion"] = payload.updateTargetVersion
        do {
            let data = try JSONSerialization.data(withJSONObject: report, options: [.sortedKeys])
            try data.write(to: URL(fileURLWithPath: path), options: [.atomic])
        } catch {
            lastError = "Update E2E report failed: \(error.localizedDescription)"
        }
    }

    nonisolated private static func result(
        payload: RuntimeHealthPayload?,
        error: NSError?
    ) -> Result<RuntimeHealthPayload, Error> {
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
    case untrustedRuntime
    case updateCheckpointRejected

    var errorDescription: String? {
        switch self {
        case .emptyReply:
            "The runtime returned an empty XPC reply."
        case .invalidProxy:
            "The runtime XPC proxy is unavailable."
        case .untrustedRuntime:
            "The XPC peer is not the ad-hoc signed runtime inside this app bundle."
        case .updateCheckpointRejected:
            "The runtime did not persist the update checkpoint."
        }
    }
}
