package dev.codewide.app.e2e

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class V2VoiceFaultReceiverTest {
  @Test
  fun acceptsOnlyTheTwoExplicitOneShotModes() {
    assertEquals(
      V2VoiceFaultMode.REVOKE_MICROPHONE_ON_KILL,
      parseV2VoiceFaultMode("revoke-microphone-on-kill"),
    )
    assertEquals(
      V2VoiceFaultMode.STOP_ACTIVE_CAPTURE,
      parseV2VoiceFaultMode("stop-active-capture"),
    )
    assertNull(parseV2VoiceFaultMode(null))
    assertNull(parseV2VoiceFaultMode("retry"))
    assertNull(parseV2VoiceFaultMode("transport-error"))
  }
}
