/// Test-only synchronization. The deadline limits failure latency; elapsed
/// time is never used as proof that a native operation has completed.
enum ConditionWaitFailure: Error {
    case timedOut
}

@MainActor
func waitForCondition(timeout: Duration = .seconds(3), _ condition: () -> Bool) async throws {
    let clock = ContinuousClock()
    let deadline = clock.now.advanced(by: timeout)
    while true {
        try Task.checkCancellation()
        if condition() { return }
        let remaining = clock.now.duration(to: deadline)
        guard remaining > .zero else { throw ConditionWaitFailure.timedOut }
        try await Task.sleep(for: min(.milliseconds(10), remaining))
    }
}
