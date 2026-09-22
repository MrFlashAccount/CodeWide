package dev.codewide.app.remote

import org.junit.Assert.*
import org.junit.Test

class VoiceOverlayLayoutSettlerTest {
  @Test fun portraitToLandscapeCoalescesInsetsAndNeverPersistsIntermediateClamp() {
    for (navigation in listOf(24f, 48f)) {
      val portrait = VoiceOverlayDisplayLayout(400, 800, OverlaySafeBounds(8f, 32f, 392f, 800f - navigation - 8f))
      val interim = VoiceOverlayDisplayLayout(800, 400, OverlaySafeBounds(8f, 32f, 792f, 400f - navigation - 8f))
      val landscape = VoiceOverlayDisplayLayout(800, 400, OverlaySafeBounds(40f, 8f, 800f - navigation - 8f, 392f))
      val settle = VoiceOverlayLayoutSettler()
      val intent = OverlayPoint(1f, 0.82f)
      val targets = mutableListOf<OverlayPoint>()
      fun frame(layout: VoiceOverlayDisplayLayout) {
        if (settle.observe(layout) && settle.commit(layout)) {
          targets.add(GlobalVoiceOverlayPlacement.restore(intent, layout.bounds(76)))
        }
      }
      frame(portrait); frame(portrait)
      settle.resetCandidate()
      frame(interim); frame(landscape); frame(landscape)
      repeat(20) { frame(landscape) }
      assertEquals(2, targets.size)
      val final = targets.last()
      assertEquals(GlobalVoiceOverlayPlacement.restore(intent, landscape.bounds(76)), final)
      assertTrue(final.x >= landscape.area.minX && final.x + 76 <= landscape.area.maxX)
      assertTrue(final.y >= landscape.area.minY && final.y + 76 <= landscape.area.maxY)
      assertNotNull(voiceOverlayMenuGeometry(OverlayPoint(final.x + 38, final.y + 38), landscape.area, 1f))
      settle.resetCandidate()
      frame(portrait); frame(portrait)
      assertEquals(targets.first(), targets.last())
    }
  }
}
