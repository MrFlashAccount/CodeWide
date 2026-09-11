package dev.codewide.app.performance

import java.io.StringReader
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class MemoryInvestigationReportTest {
  @Test
  fun `key value metrics are exported as bytes`() {
    val metrics = ProcMemoryBreakdown.readKeyValueMetrics(StringReader("""
      VmPeak: 12 kB
      VmRSS: 7 kB
      Threads: 4
    """.trimIndent()))

    assertEquals(12_288L, metrics["VmPeak"])
    assertEquals(7_168L, metrics["VmRSS"])
    assertFalse(metrics.containsKey("Threads"))
  }

  @Test
  fun `smaps aggregates mappings without retaining their paths`() {
    val summaries = ProcMemoryBreakdown.readSmaps(StringReader("""
      1000-2000 rw-p 00000000 00:00 0 [heap]
      Size: 20 kB
      Rss: 18 kB
      Pss: 16 kB
      2000-3000 r-xp 00000000 00:00 0 /system/lib64/libwebviewchromium.so
      Size: 40 kB
      Rss: 30 kB
      Pss: 24 kB
      3000-4000 rw-s 00000000 00:00 0 /dev/kgsl-3d0
      Size: 8 kB
      Rss: 6 kB
      Pss: 4 kB
      4000-5000 rw-p 00000000 00:00 0 [anon:scudo:primary]
      Size: 10 kB
      Rss: 9 kB
      Pss: 8 kB
    """.trimIndent()))

    val chromium = summaries.single { it.category == "webview-chromium" }
    val nativeHeap = summaries.single { it.category == "native-heap" }
    val graphics = summaries.single { it.category == "graphics-device" }
    assertEquals(24_576L, chromium.metricsBytes["Pss"])
    assertEquals(2, nativeHeap.mappingCount)
    assertEquals(24_576L, nativeHeap.metricsBytes["Pss"])
    assertEquals(4_096L, graphics.metricsBytes["Pss"])
    assertFalse(summaries.joinToString().contains("/system/lib64"))
  }
}
