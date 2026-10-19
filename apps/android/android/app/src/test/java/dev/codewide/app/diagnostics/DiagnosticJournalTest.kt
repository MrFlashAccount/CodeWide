package dev.codewide.app.diagnostics

import java.nio.file.Files
import java.util.UUID
import org.json.JSONObject
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DiagnosticJournalTest {
  @Test
  fun pendingStateTracksDurableReports() {
    val directory = Files.createTempDirectory("codewide-diagnostic-journal").toFile()
    try {
      val journal = DiagnosticJournal(directory)
      assertFalse(journal.hasPending())

      journal.append(
        JSONObject()
          .put("reportId", UUID.randomUUID().toString())
          .put("fields", JSONObject()),
      )

      assertTrue(journal.hasPending())
    } finally {
      directory.deleteRecursively()
    }
  }
}
