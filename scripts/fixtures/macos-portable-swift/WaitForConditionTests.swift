import Testing
@testable import CodeWide

@Suite @MainActor
struct WaitForConditionTests {
    @Test func anAlreadySatisfiedConditionDoesNotWaitForTheDeadline() async throws {
        try await waitForCondition(timeout: .zero) { true }
    }

    @Test func waitsForTheObservableResult() async throws {
        var ready = false
        let publisher = Task { @MainActor in
            await Task.yield()
            ready = true
        }
        defer { publisher.cancel() }
        try await waitForCondition { ready }
        #expect(ready)
    }

    @Test func anUnchangedConditionFailsAtTheDeadline() async {
        do {
            try await waitForCondition(timeout: .zero) { false }
            Issue.record("An unmet condition must fail, not become ready after a pause")
        } catch ConditionWaitFailure.timedOut {
            // The declared failure contract.
        } catch {
            Issue.record("Unexpected wait failure: \(error)")
        }
    }

    @Test func cancellationIsNotReportedAsReadiness() async {
        let waiter = Task { @MainActor in
            try await waitForCondition { false }
        }
        waiter.cancel()
        do {
            try await waiter.value
            Issue.record("Cancelled synchronization must not succeed")
        } catch is CancellationError {
            // Cancellation remains distinct from a native-operation timeout.
        } catch {
            Issue.record("Unexpected cancellation failure: \(error)")
        }
    }
}
