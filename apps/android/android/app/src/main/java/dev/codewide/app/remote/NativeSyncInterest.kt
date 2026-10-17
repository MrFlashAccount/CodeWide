package dev.codewide.app.remote

/**
 * The single device owner of the sync interest bounds, mirroring
 * contract/v1.json `syncInterest` (`maxInterestThreads`, `maxThreadIdChars`).
 * Every interest set is validated here before it is persisted or sent, so an
 * invalid set is rejected locally instead of closing the next `hello` or
 * `interest` frame with 1008 and reconnecting in a loop.
 */
internal object NativeSyncInterest {
  const val MAX_INTEREST_THREADS = 64
  const val MAX_INTEREST_THREAD_ID_CHARS = 256

  /** Rejects a declared list breaking a Companion bound; like Companion, the size counts duplicates. */
  fun requireValid(threadIds: List<String>) {
    require(threadIds.size <= MAX_INTEREST_THREADS) { "Interest exceeds $MAX_INTEREST_THREADS threads" }
    require(threadIds.all { it.isNotEmpty() && it.length <= MAX_INTEREST_THREAD_ID_CHARS }) {
      "Interest thread id is invalid"
    }
  }

  /** Persists a validated set for the next `hello` of a connection that has no session. */
  fun storeWithoutSession(store: NativeFrameStore, connectionId: String, threadIds: List<String>) {
    requireValid(threadIds)
    store.storeInterest(connectionId, threadIds.distinct())
  }
}
