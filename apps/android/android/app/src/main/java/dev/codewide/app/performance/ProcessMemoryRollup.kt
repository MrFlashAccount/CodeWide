package dev.codewide.app.performance

import java.io.File

internal data class ProcessMemoryRollup(
  val pssBytes: Long,
  val rssBytes: Long,
  val swapPssBytes: Long,
)

/** Reads comparable resident metrics from one kernel rollup snapshot. */
internal object ProcessMemoryRollupReader {
  fun read(file: File = File("/proc/self/smaps_rollup")): ProcessMemoryRollup =
    fromMetrics(ProcMemoryBreakdown.readKeyValueFile(file))

  fun fromMetrics(metrics: Map<String, Long>): ProcessMemoryRollup = ProcessMemoryRollup(
    pssBytes = requireNotNull(metrics["Pss"]) { "smaps_rollup did not contain Pss" },
    rssBytes = requireNotNull(metrics["Rss"]) { "smaps_rollup did not contain Rss" },
    swapPssBytes = metrics["SwapPss"] ?: 0L,
  )
}
