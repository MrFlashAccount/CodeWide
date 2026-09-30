import CodeWideShared
import Combine
import Foundation

@MainActor
final class RelaySetupModel: ObservableObject {
    @Published private(set) var enrollment: RelayEnrollmentPayload?
    @Published private(set) var error: String?
    @Published private(set) var isSubmitting = false
    private let runtime: RuntimeConnection
    private var work: Task<Void, Never>?
    private var dismissed = false

    init(runtime: RuntimeConnection) { self.runtime = runtime }

    func connect(address: String) {
        guard !isSubmitting else { return }
        dismissed = false
        error = nil
        enrollment = nil
        isSubmitting = true
        work = Task {
            defer { isSubmitting = false; work = nil }
            do {
                let attempt = try await runtime.beginRelayEnrollment(address: address)
                enrollment = attempt
                // A close during the initial XPC call must still cancel its returned handle.
                guard !dismissed else {
                    try await runtime.cancelRelayEnrollment(id: attempt.id)
                    return
                }
                while !Task.isCancelled {
                    let snapshot = try await runtime.relayEnrollmentStatus(id: attempt.id)
                    guard !dismissed else { return }
                    enrollment = snapshot
                    switch snapshot.state {
                    case "connected":
                        await runtime.relayEnrollmentCompleted()
                        return
                    case "failed", "cancelled":
                        error = snapshot.message ?? "Relay pairing ended. Run codewide-relay pair again."
                        return
                    default:
                        try await Task.sleep(for: .milliseconds(250))
                    }
                }
            } catch is CancellationError {
                // Explicit cancellation is reflected by the caller closing the window.
            } catch {
                if !dismissed { self.error = error.localizedDescription }
                if let id = enrollment?.id { try? await runtime.cancelRelayEnrollment(id: id) }
            }
        }
    }

    func cancel() {
        dismissed = true
        guard let enrollment, enrollment.state != "connected" else { return }
        work?.cancel()
        Task { try? await runtime.cancelRelayEnrollment(id: enrollment.id) }
    }
}
