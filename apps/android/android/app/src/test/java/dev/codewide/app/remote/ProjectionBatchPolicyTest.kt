package dev.codewide.app.remote

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ProjectionBatchPolicyTest {
  @Test
  fun flushesLifecycleBoundariesBeforeTheBatchIsFull() {
    assertTrue(ProjectionBatchPolicy.shouldFlushImmediately("turn/completed"))
    assertTrue(ProjectionBatchPolicy.shouldFlushImmediately("thread/status/changed"))
    assertTrue(ProjectionBatchPolicy.shouldFlushImmediately("item/tool/requestUserInput"))
  }

  @Test
  fun keepsHighFrequencyTextDeltasOnTheTimedBatchPath() {
    assertFalse(ProjectionBatchPolicy.shouldFlushImmediately("item/agentMessage/delta"))
    assertFalse(ProjectionBatchPolicy.shouldFlushImmediately("item/reasoning/textDelta"))
  }

  @Test
  fun boundsDurableGroupCommitLatencyWithoutWritingEveryFrame() {
    assertTrue(
      ProjectionBatchPolicy.flushDelayMs("item/agentMessage/delta") <
        ProjectionBatchPolicy.flushDelayMs("item/commandExecution/outputDelta"),
    )
    assertTrue(ProjectionBatchPolicy.flushDelayMs("item/agentMessage/delta") == 12L)
    assertTrue(ProjectionBatchPolicy.flushDelayMs("item/plan/delta") == 12L)
    assertTrue(ProjectionBatchPolicy.flushDelayMs("item/reasoning/summaryTextDelta") == 12L)
    assertTrue(ProjectionBatchPolicy.flushDelayMs("item/reasoning/textDelta") == 12L)
    assertTrue(ProjectionBatchPolicy.flushDelayMs("item/commandExecution/outputDelta") == 16L)
  }
}
