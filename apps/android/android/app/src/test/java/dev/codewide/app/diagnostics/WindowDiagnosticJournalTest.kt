package dev.codewide.app.diagnostics

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class WindowDiagnosticJournalTest {
  @Test
  fun optInStopAndNewSessionRespectReportLifetime() {
    val journal = WindowDiagnosticJournal()
    journal.record(1, "layout", "disabled")
    assertEquals(emptyList<String>(), geometry(journal))
    journal.start()
    journal.record(2, "start", "windowed")
    journal.stop()
    journal.record(3, "layout", "fullscreen")
    assertFalse(journal.enabled)
    assertEquals(listOf("windowed"), geometry(journal))
    journal.start()
    assertEquals(emptyList<String>(), geometry(journal))
  }

  @Test
  fun layoutNoiseDoesNotEraseConfigurationEvidence() {
    val journal = WindowDiagnosticJournal(2)
    journal.start()
    journal.record(1, "configuration_react", "mismatch")
    repeat(20) { journal.record(2, "layout", "mismatch") }
    journal.record(3, "configuration_activity", "aligned")
    assertEquals(listOf("mismatch", "aligned"), geometry(journal))
    assertEquals(0, journal.droppedSamples)
    journal.record(4, "layout", "resized")
    assertEquals(listOf("aligned", "resized"), geometry(journal))
    assertEquals(1, journal.droppedSamples)
  }

  @Test
  fun repeatedStartDoesNotClearARecording() {
    val journal = WindowDiagnosticJournal()
    journal.start()
    journal.record(1, "start", "windowed")
    journal.start()
    assertEquals(listOf("windowed"), geometry(journal))
  }

  private fun geometry(journal: WindowDiagnosticJournal): List<String> {
    val result = mutableListOf<String>()
    journal.forEachSample { result.add(it.geometry) }
    return result
  }
}
