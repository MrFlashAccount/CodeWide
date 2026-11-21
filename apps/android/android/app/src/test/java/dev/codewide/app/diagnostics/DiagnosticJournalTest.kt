package dev.codewide.app.diagnostics

import java.io.File
import java.nio.file.Files
import java.util.UUID
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DiagnosticJournalTest {
  private val directory: File = Files.createTempDirectory("codewide-diagnostic-journal").toFile()
  private var clock = 1_000_000L

  @After fun cleanUp() {
    directory.deleteRecursively()
  }

  @Test
  fun pendingStateTracksQueuedReports() {
    val journal = journal()
    assertFalse(journal.hasPending())

    val file = journal.append(report())

    assertTrue(journal.hasPending())
    assertEquals(listOf(file), journal.pending())
  }

  @Test
  fun theOldestReportsRotateOutAtTheReportLimit() {
    val journal = journal(DiagnosticJournalLimits(maxReports = 3))
    val files = (1..5).map { journal.append(report()).also { clock += 1 } }

    assertEquals(files.takeLast(3), journal.pending())
    assertFalse(files[0].exists())
    assertFalse(files[1].exists())
  }

  @Test
  fun theOldestReportsRotateOutAtTheByteLimit() {
    val sample = report().toString().toByteArray(Charsets.UTF_8).size.toLong()
    val journal = journal(DiagnosticJournalLimits(maxBytes = sample * 2))
    val files = (1..4).map { journal.append(report()) }

    assertEquals(files.takeLast(2), journal.pending())
    assertEquals(2, directory.listFiles { file -> file.name.endsWith(".json") }!!.size)
  }

  @Test
  fun reportsOlderThanTheAgeLimitRotateOutOnTheNextWrite() {
    val journal = journal(DiagnosticJournalLimits(maxAgeMillis = 1_000))
    val stale = journal.append(report())
    clock += 5_000

    val fresh = journal.append(report())

    assertEquals(listOf(fresh), journal.pending())
    assertFalse(stale.exists())
  }

  @Test
  fun aReopenedJournalKeepsItsNewestReportsWithinItsLimits() {
    val first = journal()
    val files = (1..4).map { index ->
      first.append(report()).also { it.setLastModified(clock - (5 - index) * 1_000L) }
    }

    val reopened = journal(DiagnosticJournalLimits(maxReports = 2))

    assertEquals(files.takeLast(2), reopened.pending())
  }

  @Test
  fun aMatchingReceiptRemovesTheReportAndItsTarget() {
    val journal = journal()
    val file = journal.append(report())
    journal.target(file, "connection")
    val receipt = JSONObject().put("reportId", file.nameWithoutExtension).put("sha256", DiagnosticJournal.sha256(file))

    assertTrue(journal.acknowledge(file, receipt))
    assertFalse(journal.hasPending())
    assertEquals(0, directory.listFiles()!!.size)
  }

  @Test
  fun anUnfinishedWriteIsDiscardedOnOpen() {
    File(directory, "diagnostic-1.pending").writeText("partial")

    journal()

    assertEquals(0, directory.listFiles()!!.size)
  }

  private fun journal(limits: DiagnosticJournalLimits = DiagnosticJournalLimits()) =
    DiagnosticJournal(directory, limits) { clock }

  private fun report(): JSONObject =
    JSONObject().put("reportId", UUID.randomUUID().toString()).put("fields", JSONObject())
}
