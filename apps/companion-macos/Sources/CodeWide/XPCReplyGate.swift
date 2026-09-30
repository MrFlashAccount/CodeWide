import Foundation

/// Completes a callback request exactly once, including cancellation before dispatch.
final class XPCReplyGate<Value: Sendable>: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<Value, Error>?
    private var result: Result<Value, Error>?
    private var finished = false
    private var timeoutTask: Task<Void, Never>?

    @MainActor
    static func perform(
        timeout: Duration = .seconds(10),
        operation: (XPCReplyGate<Value>) -> Void
    ) async throws -> Value {
        let gate = XPCReplyGate<Value>()
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                guard gate.install(continuation) else { return }
                gate.armTimeout(after: timeout)
                guard !Task.isCancelled else {
                    gate.resume(with: .failure(CancellationError()))
                    return
                }
                operation(gate)
            }
        } onCancel: {
            gate.resume(with: .failure(CancellationError()))
        }
    }

    private func install(_ continuation: CheckedContinuation<Value, Error>) -> Bool {
        lock.lock()
        if finished {
            let result = result!
            self.result = nil
            lock.unlock()
            continuation.resume(with: result)
            return false
        }
        self.continuation = continuation
        lock.unlock()
        return true
    }

    @discardableResult
    func resume(with result: Result<Value, Error>) -> Bool {
        lock.lock()
        guard !finished else {
            lock.unlock()
            return false
        }
        finished = true
        let pending = continuation
        continuation = nil
        if pending == nil { self.result = result }
        let timer = timeoutTask
        timeoutTask = nil
        lock.unlock()
        timer?.cancel()
        pending?.resume(with: result)
        return true
    }

    private func armTimeout(after duration: Duration) {
        // Retain the gate until the deadline even when the peer drops its reply block.
        let timer = Task {
            do {
                try await Task.sleep(for: duration)
            } catch {
                return
            }
            resume(with: .failure(RuntimeConnectionError.requestTimedOut))
        }
        lock.lock()
        if finished {
            lock.unlock()
            timer.cancel()
        } else {
            timeoutTask = timer
            lock.unlock()
        }
    }
}
