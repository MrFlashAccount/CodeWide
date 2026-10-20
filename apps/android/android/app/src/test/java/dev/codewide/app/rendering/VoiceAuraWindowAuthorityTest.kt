package dev.codewide.app.rendering

import org.junit.Assert.assertEquals
import org.junit.Test

class VoiceAuraWindowAuthorityTest {
  @Test
  fun claimingAWindowSupersedesOnlyThePreviousOwner() {
    val authority = VoiceAuraWindowAuthority()
    val first = FakeOwner()
    val second = FakeOwner()
    val third = FakeOwner()

    authority.claim(first)
    authority.claim(first)
    assertEquals(0, first.superseded)

    authority.claim(second)
    assertEquals(1, first.superseded)
    assertEquals(0, second.superseded)

    authority.release(first)
    authority.claim(third)
    assertEquals(1, second.superseded)
    assertEquals(0, third.superseded)

    authority.release(third)
    authority.claim(first)
    assertEquals(0, third.superseded)
  }

  private class FakeOwner : VoiceAuraWindowOwner {
    var superseded = 0

    override fun onVoiceAuraWindowSuperseded() {
      superseded += 1
    }
  }
}
