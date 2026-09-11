package dev.codewide.app.rendering

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class VoiceAuraTransitionTest {
  @Test
  fun openingMatchesCssBezierAndCompletesAt1100Milliseconds() {
    val transition = VoiceAuraTransition()
    transition.setActive(true, false)
    // On cubic-bezier(.25, .1, .25, 1), parameter t=.5 yields x=.3125 and y=.5375.
    assertEquals(0.5375f, transition.advance(1.1f * 0.3125f), 0.00001f)
    transition.advance(1.1f * (1f - 0.3125f) - 0.01f)
    assertTrue(transition.value < 1f)
    assertEquals(1f, transition.advance(0.011f), 0f)
    assertEquals(1f, transition.opacity, 0f)
  }

  @Test
  fun closingUsesQuadraticEaseOutThen200MillisecondFade() {
    val transition = VoiceAuraTransition()
    transition.setActive(true, false)
    transition.advance(1.1f)
    transition.setActive(false, false)
    assertEquals(0.25f, transition.advance(0.26f), 0.00001f)
    assertEquals(0f, transition.advance(0.26f), 0f)
    assertEquals(1f, transition.opacity, 0f)
    assertTrue(transition.isVisible)
    transition.advance(0.1f)
    assertEquals(0.5f, transition.opacity, 0.00001f)
    transition.advance(0.101f)
    assertFalse(transition.isVisible)
    assertEquals(0f, transition.opacity, 0f)
  }

  @Test
  fun recordingLengthDoesNotExtendClosing() {
    val transition = VoiceAuraTransition()
    transition.setActive(true, false)
    transition.advance(3600f)
    transition.setActive(false, false)
    assertEquals(0.25f, transition.advance(0.26f), 0.00001f)
    transition.advance(0.461f)
    assertFalse(transition.isVisible)
  }

  @Test
  fun reversingAnUnfinishedAnimationPreservesDisplayedPosition() {
    val transition = VoiceAuraTransition()
    transition.setActive(true, false)
    val interrupted = transition.advance(0.3f)
    transition.setActive(false, false)
    assertEquals(interrupted, transition.value, 0f)
    val closing = transition.advance(0.13f)
    assertTrue(closing < interrupted)
    transition.setActive(true, false)
    assertEquals(closing, transition.value, 0f)
    assertTrue(transition.advance(0.1f) > closing)
    assertEquals(1f, transition.advance(1f), 0f)
  }

  @Test
  fun reopeningDuringFadePreservesOpacityAndCancelsOldDismissal() {
    val transition = VoiceAuraTransition()
    transition.setActive(true, false)
    transition.advance(1.1f)
    transition.setActive(false, false)
    transition.advance(0.62f)
    val faded = transition.opacity
    transition.setActive(true, false)
    assertEquals(faded, transition.opacity, 0f)
    transition.advance(0.2f)
    assertTrue(transition.opacity > faded)
    assertTrue(transition.isVisible)
    transition.advance(0.9f)
    assertEquals(1f, transition.opacity, 0f)
    assertEquals(1f, transition.value, 0f)
  }

  @Test
  fun frameRateDoesNotChangeTimingAndRepeatedStateDoesNotRestart() {
    val singleFrame = VoiceAuraTransition()
    val manyFrames = VoiceAuraTransition()
    singleFrame.setActive(true, false)
    manyFrames.setActive(true, false)
    singleFrame.advance(0.55f)
    repeat(55) {
      manyFrames.setActive(true, false)
      manyFrames.advance(0.01f)
    }
    assertEquals(singleFrame.value, manyFrames.value, 0.00001f)
    val previous = manyFrames.value
    assertEquals(previous, manyFrames.advance(-1f), 0f)
    manyFrames.advance(0.56f)
    assertEquals(1f, manyFrames.value, 0f)
  }

  @Test
  fun reducedMotionAndClearSettleWithoutLeavingAnOverlay() {
    val transition = VoiceAuraTransition()
    transition.setActive(true, false)
    transition.advance(0.2f)
    transition.setActive(true, true)
    assertEquals(1f, transition.value, 0f)
    transition.setActive(false, true)
    assertFalse(transition.isVisible)
    assertEquals(0f, transition.opacity, 0f)
    transition.setActive(true, false)
    transition.advance(0.1f)
    transition.reset()
    assertFalse(transition.isVisible)
    assertEquals(0f, transition.advance(10f), 0f)
    transition.setActive(true, false)
    assertEquals(0.5375f, transition.advance(1.1f * 0.3125f), 0.00001f)
  }
}
