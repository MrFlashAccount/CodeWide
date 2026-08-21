package dev.codewide.app.remote

/**
 * Text and tool deltas are frame-batched. Lifecycle boundaries and user
 * decisions flush the partial batch immediately so the UI never waits for the
 * count/byte ceiling or the normal frame deadline.
 */
internal object ProjectionBatchPolicy {
  // These deadlines now bound durable group commits, not React renders. The
  // JS projection may still coalesce work when it falls behind.
  const val NORMAL_FLUSH_DELAY_MS = 16L
  const val TEXT_FLUSH_DELAY_MS = 12L

  private val immediateMethods = setOf(
    "turn/started",
    "turn/completed",
    "item/started",
    "item/completed",
    "thread/status/changed",
    "serverRequest/resolved",
    "item/commandExecution/requestApproval",
    "item/fileChange/requestApproval",
    "item/tool/requestUserInput",
    "item/permissions/requestApproval",
    "mcpServer/elicitation/request",
    "thread/realtime/error",
    "thread/realtime/closed",
    "error",
  )
  private val lowLatencyMethods = setOf(
    "item/agentMessage/delta",
    "item/plan/delta",
    "item/reasoning/summaryTextDelta",
    "item/reasoning/textDelta",
  )

  fun shouldFlushImmediately(method: String): Boolean = immediateMethods.contains(method)

  fun flushDelayMs(method: String): Long = if (lowLatencyMethods.contains(method)) {
    TEXT_FLUSH_DELAY_MS
  } else {
    NORMAL_FLUSH_DELAY_MS
  }
}
