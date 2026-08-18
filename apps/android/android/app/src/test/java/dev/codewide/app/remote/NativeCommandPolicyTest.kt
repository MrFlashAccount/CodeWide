package dev.codewide.app.remote

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeCommandPolicyTest {
  @Test
  fun onlyDeclaredCommandsEnterTheDurableQueue() {
    assertTrue(NativeCommandPolicy.accepts("turn/start"))
    assertTrue(NativeCommandPolicy.accepts("serverRequest/respond"))
    assertTrue(NativeCommandPolicy.accepts("companion/queue/put"))
    assertFalse(NativeCommandPolicy.accepts("thread/fork"))
    assertFalse(NativeCommandPolicy.accepts("thread/compact/start"))
  }

  @Test
  fun ambiguousSideEffectsHaveExplicitReconciliation() {
    assertEquals(
      NativeCommandReconciliation.TURN_BY_CLIENT_MESSAGE,
      NativeCommandPolicy.reconciliation("turn/steer"),
    )
    assertEquals(
      NativeCommandReconciliation.SERVER_REQUEST_BY_PENDING_SET,
      NativeCommandPolicy.reconciliation("serverRequest/respond"),
    )
    assertEquals(
      NativeCommandReconciliation.IDEMPOTENT_RETRY,
      NativeCommandPolicy.reconciliation("thread/settings/update"),
    )
  }

  @Test
  fun interruptBypassesTheActiveTurnFifoLane() {
    assertEquals("thread:thread-1", NativeCommandPolicy.deliveryLane("turn/start", "thread-1"))
    assertEquals("thread:thread-1", NativeCommandPolicy.deliveryLane("turn/steer", "thread-1"))
    assertEquals("thread:thread-1:control", NativeCommandPolicy.deliveryLane("turn/interrupt", "thread-1"))
  }
}
