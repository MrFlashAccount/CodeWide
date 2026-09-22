import Foundation

final class XPCReplyGate<Value: Sendable>: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<Value, Error>?

    init(continuation: CheckedContinuation<Value, Error>) {
        self.continuation = continuation
    }

    @discardableResult
    func resume(with result: sending Result<Value, Error>) -> Bool {
        lock.lock()
        let pending = continuation
        continuation = nil
        lock.unlock()
        guard let pending else {
            return false
        }
        pending.resume(with: result)
        return true
    }

    func timeout(
        after duration: Duration,
        with error: any Error & Sendable
    ) {
        Task { [weak self] in
            do {
                try await Task.sleep(for: duration)
            } catch {
                return
            }
            self?.resume(with: .failure(error))
        }
    }
}
