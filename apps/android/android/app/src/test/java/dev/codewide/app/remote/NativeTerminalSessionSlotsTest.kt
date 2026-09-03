package dev.codewide.app.remote

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class NativeTerminalSessionSlotsTest {
  @Test
  fun generationSwitchReclaimsEightLegacyTerminalSlotsBeforeV1Returns() {
    val slots = NativeTerminalSessionSlots<String>(8)
    repeat(8) { index -> slots.allocate("legacy-$index") { "session-$index" } }
    assertThrows(IllegalArgumentException::class.java) {
      slots.allocate("legacy-over-capacity") { "session-over-capacity" }
    }

    slots.deactivate().forEach(slots::remove)
    assertThrows(IllegalStateException::class.java) {
      slots.allocate("stale-v1-runtime") { "stale-session" }
    }
    slots.activate()

    repeat(8) { index -> slots.allocate("new-legacy-$index") { "new-session-$index" } }
    assertEquals(8, slots.values.size)
  }
}
