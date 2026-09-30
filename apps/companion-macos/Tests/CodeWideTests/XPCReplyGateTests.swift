import Foundation
import Testing
@testable import CodeWide

@Suite(.timeLimit(.minutes(1)))
@MainActor
struct XPCReplyGateTests {
    @Test func firstReplyWins() async throws {
        let result: Int = try await XPCReplyGate.perform { gate in
            #expect(gate.resume(with: .success(42)))
            #expect(!gate.resume(with: .failure(CancellationError())))
            #expect(!gate.resume(with: .success(99)))
        }
        #expect(result == 42)
    }

    @Test func droppedReplyTimesOut() async {
        do {
            let _: Int = try await XPCReplyGate.perform(timeout: .milliseconds(10)) { _ in }
            Issue.record("A peer that drops its reply must time out")
        } catch {
            #expect(error is RuntimeConnectionError)
        }
    }

    @Test func cancellationBeforeDispatchDoesNotSend() async {
        let task = Task { @MainActor in
            withUnsafeCurrentTask { $0?.cancel() }
            return try await XPCReplyGate<Int>.perform { _ in
                Issue.record("A cancelled request must not be dispatched")
            }
        }
        do {
            _ = try await task.value
            Issue.record("Cancellation must resume the caller")
        } catch {
            #expect(error is CancellationError)
        }
    }

    @Test func cancellationWhileWaitingDoesNotWaitForTimeout() async {
        var dispatched = false
        let task = Task { @MainActor in
            try await XPCReplyGate<Int>.perform(timeout: .seconds(60)) { _ in
                dispatched = true
            }
        }
        while !dispatched { await Task.yield() }
        task.cancel()
        do {
            _ = try await task.value
            Issue.record("Cancellation must resume the caller")
        } catch {
            #expect(error is CancellationError)
        }
    }

    @Test func delayedReplyAfterTimeoutIsIgnored() async throws {
        var pending: XPCReplyGate<Int>?
        do {
            let _: Int = try await XPCReplyGate.perform(timeout: .milliseconds(10)) {
                pending = $0
            }
            Issue.record("Expected deadline")
        } catch {
            #expect(error is RuntimeConnectionError)
        }
        #expect(try #require(pending).resume(with: .success(1)) == false)
    }
}
