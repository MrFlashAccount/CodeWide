package dev.codewide.app.performance

import org.junit.Assert.assertEquals
import org.junit.Test

class ProcessMemoryRollupTest {
  @Test
  fun `resident metrics come from the same rollup`() {
    val rollup = ProcessMemoryRollupReader.fromMetrics(
      mapOf(
        "Rss" to 734_003_200L,
        "Pss" to 471_859_200L,
        "SwapPss" to 52_428_800L,
      ),
    )

    assertEquals(734_003_200L, rollup.rssBytes)
    assertEquals(471_859_200L, rollup.pssBytes)
    assertEquals(52_428_800L, rollup.swapPssBytes)
  }

  @Test
  fun `missing swap pss is treated as zero`() {
    val rollup = ProcessMemoryRollupReader.fromMetrics(
      mapOf(
        "Rss" to 8_192L,
        "Pss" to 4_096L,
      ),
    )

    assertEquals(0L, rollup.swapPssBytes)
  }
}
