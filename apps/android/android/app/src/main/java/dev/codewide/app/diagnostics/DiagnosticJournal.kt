package dev.codewide.app.diagnostics

import java.io.File
import java.io.FileOutputStream
import java.nio.channels.FileChannel
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.nio.file.StandardOpenOption
import java.security.MessageDigest
import java.util.UUID
import org.json.JSONObject

/** How much the outbox may hold; the oldest reports go first once any limit is exceeded. */
internal data class DiagnosticJournalLimits(
  val maxReports: Int = 500,
  val maxBytes: Long = 4L * 1024 * 1024,
  val maxAgeMillis: Long = 3L * 24 * 60 * 60 * 1000,
)

/**
 * Bounded, disposable outbox in the application cache. Reports leave it on a matching
 * server receipt or by rotation: losing an old report is acceptable, growing without a
 * bound is not. Only reports written right before the process may die are fsynced.
 */
internal class DiagnosticJournal(
  private val directory: File,
  private val limits: DiagnosticJournalLimits = DiagnosticJournalLimits(),
  private val now: () -> Long = System::currentTimeMillis,
) {
  private class Entry(val file: File, val bytes: Long, val writtenAt: Long)

  // Oldest first; the directory is listed once, then this index owns the rotation order.
  private val entries = ArrayDeque<Entry>()
  private var totalBytes = 0L

  init {
    check(directory.mkdirs() || directory.isDirectory) { "Diagnostic outbox is unavailable" }
    directory.listFiles { file -> file.name.endsWith(".pending") }?.forEach(File::delete)
    directory.listFiles { file -> file.name.endsWith(".json") }
      ?.sortedBy(File::lastModified)
      ?.forEach { file -> track(Entry(file, file.length(), file.lastModified())) }
    rotate()
  }

  /** Writes the report unless it is already queued; [durable] commits it before returning. */
  @Synchronized
  fun append(report: JSONObject, durable: Boolean = false): File {
    val id = UUID.fromString(report.getString("reportId")).toString()
    val destination = File(directory, "$id.json")
    if (destination.exists()) return destination
    val bytes = report.toString().toByteArray(Charsets.UTF_8)
    writeAtomic(destination, bytes, durable)
    track(Entry(destination, bytes.size.toLong(), now()))
    rotate()
    return destination
  }

  /** A snapshot of the queued reports, oldest first; rotation may remove one before it is read. */
  @Synchronized
  fun pending(): List<File> = entries.map(Entry::file)

  @Synchronized
  fun hasPending(): Boolean = entries.isNotEmpty()

  @Synchronized
  fun target(file: File, fallbackConnectionId: String): String {
    val target = targetOf(file)
    if (target.exists()) return target.readText(Charsets.UTF_8)
    val fields = JSONObject(file.readText(Charsets.UTF_8)).getJSONObject("fields")
    val connection = fields.optString("connectionId").takeIf { it.isNotBlank() } ?: fallbackConnectionId
    writeAtomic(target, connection.toByteArray(Charsets.UTF_8), durable = false)
    return connection
  }

  @Synchronized
  fun acknowledge(file: File, receipt: JSONObject): Boolean {
    if (!file.isFile) return false
    if (receipt.optString("reportId") != file.nameWithoutExtension || receipt.optString("sha256") != sha256(file)) return false
    val entry = entries.firstOrNull { it.file == file }
    if (entry != null) remove(entry) else { file.delete(); targetOf(file).delete() }
    return true
  }

  private fun track(entry: Entry) {
    entries.addLast(entry)
    totalBytes += entry.bytes
  }

  private fun rotate() {
    val oldestAllowed = now() - limits.maxAgeMillis
    while (true) {
      val oldest = entries.firstOrNull() ?: return
      val overLimit = entries.size > limits.maxReports || totalBytes > limits.maxBytes
      if (!overLimit && oldest.writtenAt >= oldestAllowed) return
      remove(oldest)
    }
  }

  private fun remove(entry: Entry) {
    entries.remove(entry)
    totalBytes -= entry.bytes
    entry.file.delete()
    targetOf(entry.file).delete()
  }

  private fun targetOf(file: File): File = File(directory, "${file.nameWithoutExtension}.target")

  private fun writeAtomic(destination: File, bytes: ByteArray, durable: Boolean) {
    val pending = File.createTempFile("diagnostic-", ".pending", directory)
    try {
      FileOutputStream(pending).use { output ->
        output.write(bytes)
        if (durable) output.fd.sync()
      }
      Files.move(pending.toPath(), destination.toPath(), StandardCopyOption.ATOMIC_MOVE)
      if (durable) FileChannel.open(directory.toPath(), StandardOpenOption.READ).use { it.force(true) }
    } finally { pending.delete() }
  }

  companion object {
    fun sha256(file: File): String {
      val digest = MessageDigest.getInstance("SHA-256")
      file.inputStream().use { input ->
        val buffer = ByteArray(64 * 1024)
        while (true) { val count = input.read(buffer); if (count < 0) break; digest.update(buffer, 0, count) }
      }
      return digest.digest().joinToString("") { "%02x".format(it) }
    }
  }
}
