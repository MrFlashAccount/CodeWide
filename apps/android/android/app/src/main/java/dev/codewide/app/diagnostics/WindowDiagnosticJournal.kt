package dev.codewide.app.diagnostics

/** Main-thread, bounded session history. Geometry is serialized at capture to detach live metrics. */
internal class WindowDiagnosticJournal(private val capacity: Int = 160) {
  data class Sample(val unixMs: Long, val reason: String, val geometry: String)
  private val samples = ArrayDeque<Sample>()
  var enabled = false
    private set
  var droppedSamples = 0
    private set

  init { require(capacity > 0) }

  fun start() {
    if (enabled) return
    samples.clear()
    droppedSamples = 0
    enabled = true
  }

  fun stop() { enabled = false }

  fun record(unixMs: Long, reason: String, geometry: String) {
    if (!enabled) return
    if (reason == "layout" && samples.lastOrNull()?.geometry == geometry) return
    if (samples.size == capacity) {
      samples.removeFirst()
      droppedSamples += 1
    }
    samples.addLast(Sample(unixMs, reason, geometry))
  }

  fun forEachSample(consume: (Sample) -> Unit) { samples.forEach(consume) }
}
