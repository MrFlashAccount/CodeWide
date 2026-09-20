package dev.codewide.app.rendering

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class VoiceAuraFramePacerTest {
  @Test
  fun defaultCadenceLeavesAlternateSixtyHertzFramesForInput() {
    val pacer = VoiceAuraFramePacer()

    assertTrue(pacer.shouldDraw(0L))
    assertFalse(pacer.shouldDraw(16_666_667L))
    assertTrue(pacer.shouldDraw(33_333_334L))
  }

  @Test
  fun boundsAuraDrawsWithoutAccumulatingSkippedFrameTime() {
    val pacer = VoiceAuraFramePacer(intervalNanos = 16L)

    assertTrue(pacer.shouldDraw(100L))
    assertFalse(pacer.shouldDraw(108L))
    assertTrue(pacer.shouldDraw(116L))
    assertFalse(pacer.shouldDraw(123L))
    assertTrue(pacer.shouldDraw(132L))
  }

  @Test
  fun resetAndClockRollbackDrawImmediately() {
    val pacer = VoiceAuraFramePacer(intervalNanos = 16L)

    assertTrue(pacer.shouldDraw(100L))
    assertTrue(pacer.shouldDraw(90L))
    assertFalse(pacer.shouldDraw(91L))
    pacer.reset()
    assertTrue(pacer.shouldDraw(91L))
  }
}
