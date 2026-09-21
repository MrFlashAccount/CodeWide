import CodeWideShared
import CompanionSwiftFFI
import Darwin
import Foundation

final class RuntimeService: NSObject, RuntimeXPCProtocol, @unchecked Sendable {
    private let core: CoreHost
    private let runtimeExecutablePath: String

    init(core: CoreHost, runtimeExecutablePath: String) {
        self.core = core
        self.runtimeExecutablePath = runtimeExecutablePath
    }

    func health(
        withReply reply: @escaping @Sendable (RuntimeHealthPayload?, NSError?) -> Void
    ) {
        do {
            reply(try payload(from: core.health()), nil)
        } catch {
            reply(nil, error as NSError)
        }
    }

    func prepareForUpdate(
        targetVersion: String,
        withReply reply: @escaping @Sendable (RuntimeHealthPayload?, NSError?) -> Void
    ) {
        do {
            let health = try core.prepareForUpdate(targetVersion: targetVersion)
            reply(payload(from: health), nil)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
                exit(EXIT_SUCCESS)
            }
        } catch {
            reply(nil, error as NSError)
        }
    }

    private func payload(from health: FfiRuntimeHealth) -> RuntimeHealthPayload {
        RuntimeHealthPayload(
            phase: health.phase,
            degradedReason: health.degradedReason,
            appVersion: health.appVersion,
            hostVersion: health.hostVersion,
            coreVersion: health.coreVersion,
            stateSchema: health.stateSchema,
            processID: Int32(bitPattern: health.processId),
            launchCount: health.launchCount,
            startedAtUnixMilliseconds: health.startedAtUnixMs,
            updateStatus: health.updateStatus,
            updateFromVersion: health.updateFromVersion,
            updateTargetVersion: health.updateTargetVersion,
            updateFailureReason: health.updateFailureReason,
            hostExecutablePath: runtimeExecutablePath
        )
    }
}
