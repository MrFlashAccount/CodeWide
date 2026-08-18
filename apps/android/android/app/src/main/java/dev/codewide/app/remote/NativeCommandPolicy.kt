package dev.codewide.app.remote

internal enum class NativeCommandReconciliation {
  TURN_BY_CLIENT_MESSAGE,
  SERVER_REQUEST_BY_PENDING_SET,
  IDEMPOTENT_RETRY,
}

/** Contract for commands that are safe to persist past an interrupted socket. */
internal object NativeCommandPolicy {
  private val policies = mapOf(
    "turn/start" to NativeCommandReconciliation.TURN_BY_CLIENT_MESSAGE,
    "turn/steer" to NativeCommandReconciliation.TURN_BY_CLIENT_MESSAGE,
    "serverRequest/respond" to NativeCommandReconciliation.SERVER_REQUEST_BY_PENDING_SET,
    "thread/name/set" to NativeCommandReconciliation.IDEMPOTENT_RETRY,
    "thread/archive" to NativeCommandReconciliation.IDEMPOTENT_RETRY,
    "thread/unarchive" to NativeCommandReconciliation.IDEMPOTENT_RETRY,
    "thread/delete" to NativeCommandReconciliation.IDEMPOTENT_RETRY,
    "thread/settings/update" to NativeCommandReconciliation.IDEMPOTENT_RETRY,
    "turn/interrupt" to NativeCommandReconciliation.IDEMPOTENT_RETRY,
    // Companion queue mutations carry their stable target command id.
    "companion/queue/put" to NativeCommandReconciliation.IDEMPOTENT_RETRY,
    "companion/queue/edit" to NativeCommandReconciliation.IDEMPOTENT_RETRY,
    "companion/queue/cancel" to NativeCommandReconciliation.IDEMPOTENT_RETRY,
    "companion/queue/retry" to NativeCommandReconciliation.IDEMPOTENT_RETRY,
    "companion/queue/move" to NativeCommandReconciliation.IDEMPOTENT_RETRY,
    "companion/queue/steer" to NativeCommandReconciliation.IDEMPOTENT_RETRY,
  )

  fun accepts(method: String): Boolean = policies.containsKey(method)

  fun reconciliation(method: String): NativeCommandReconciliation? = policies[method]

  /**
   * Commands are FIFO inside a lane, not across the whole connection.
   *
   * An uncertain turn/start remains at the head of the thread lane until it is
   * reconciled by clientMessageId. A stop must therefore use a separate control
   * lane or it can never reach the host while the turn it should interrupt is
   * active. A successful RPC response is delivered and never occupies a lane.
   */
  fun deliveryLane(method: String, threadId: String?): String = when {
    method == "turn/interrupt" && threadId != null -> "thread:$threadId:control"
    threadId != null -> "thread:$threadId"
    else -> "__global__"
  }
}
