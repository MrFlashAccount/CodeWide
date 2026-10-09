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

/** Atomic disk outbox. Only a matching durable server receipt permits removal. */
internal class DiagnosticJournal(private val directory: File) {
  init {
    check(directory.mkdirs() || directory.isDirectory) { "Diagnostic outbox is unavailable" }
    directory.parentFile?.let { parent ->
      FileChannel.open(parent.toPath(), StandardOpenOption.READ).use { it.force(true) }
    }
  }

  @Synchronized
  fun append(report: JSONObject): File {
    val id = UUID.fromString(report.getString("reportId")).toString()
    val destination = File(directory, "$id.json")
    if (!destination.exists()) writeAtomic(destination, report.toString().toByteArray(Charsets.UTF_8))
    return destination
  }

  fun pending(): java.nio.file.DirectoryStream<java.nio.file.Path> =
    Files.newDirectoryStream(directory.toPath(), "*.json")

  @Synchronized
  fun target(file: File, fallbackConnectionId: String): String {
    val target = File(directory, "${file.nameWithoutExtension}.target")
    if (target.exists()) return target.readText(Charsets.UTF_8)
    val fields = JSONObject(file.readText(Charsets.UTF_8)).getJSONObject("fields")
    val connection = fields.optString("connectionId").takeIf { it.isNotBlank() } ?: fallbackConnectionId
    writeAtomic(target, connection.toByteArray(Charsets.UTF_8))
    return connection
  }

  @Synchronized
  fun acknowledge(file: File, receipt: JSONObject): Boolean {
    if (receipt.optString("reportId") != file.nameWithoutExtension || receipt.optString("sha256") != sha256(file)) return false
    check(file.delete()) { "Confirmed diagnostic report could not be removed" }
    File(directory, "${file.nameWithoutExtension}.target").delete()
    syncDirectory()
    return true
  }

  private fun writeAtomic(destination: File, bytes: ByteArray) {
    val pending = File.createTempFile("diagnostic-", ".pending", directory)
    try {
      FileOutputStream(pending).use { output -> output.write(bytes); output.fd.sync() }
      Files.move(pending.toPath(), destination.toPath(), StandardCopyOption.ATOMIC_MOVE)
      syncDirectory()
    } finally { pending.delete() }
  }

  private fun syncDirectory() {
    FileChannel.open(directory.toPath(), StandardOpenOption.READ).use { it.force(true) }
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
