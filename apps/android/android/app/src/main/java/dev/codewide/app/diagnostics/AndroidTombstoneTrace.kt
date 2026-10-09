package dev.codewide.app.diagnostics

import java.io.ByteArrayInputStream
import java.io.EOFException
import java.io.InputStream

/** Validated adapter for debuggerd/proto/tombstone.proto (AOSP).
 * Preserves all thread, allocation and deallocation backtraces. Memory dumps,
 * arbitrary crash-detail blobs, command arguments and log buffers are private data, not stack frames.
 */
internal object AndroidTombstoneTrace {
  fun read(input: InputStream): String = buildString {
    val reader = ProtoReader(input)
    reader.fields { number, wire ->
      when (number) {
        1, 5, 6, 7, 20 -> appendLine("${mapOf(1 to "architecture", 5 to "pid", 6 to "tid", 7 to "uid", 20 to "uptimeSeconds")[number]}=${reader.integer(wire)}")
        2, 3, 4, 14 -> appendLine("${mapOf(2 to "buildFingerprint", 3 to "revision", 4 to "timestamp", 14 to "abortMessage")[number]}=${reader.text(wire)}")
        10 -> appendSignal(reader.message(wire), this)
        15 -> appendCause(reader.message(wire), this)
        16, 25 -> appendThreadEntry(reader.message(wire), this)
        26 -> appendStackHistory(reader.message(wire), this)
        else -> reader.skip(wire)
      }
    }
  }

  private fun appendStackHistory(reader: ProtoReader, output: StringBuilder) {
    reader.fields { number, wire ->
      when (number) {
        1 -> output.appendLine("stackHistory.tid=${reader.integer(wire)}")
        2 -> reader.message(wire).let { entry ->
          entry.fields { field, entryWire ->
            when (field) {
              1 -> { output.append("stackHistory "); appendFrame(entry.message(entryWire), output) }
              2, 3 -> output.appendLine("stackHistory.$field=${entry.integer(entryWire)}")
              else -> entry.skip(entryWire)
            }
          }
        }
        else -> reader.skip(wire)
      }
    }
  }

  private fun appendSignal(reader: ProtoReader, output: StringBuilder) {
    reader.fields { number, wire ->
      when (number) {
        1, 3, 6, 7, 9 -> output.appendLine("signal.$number=${reader.integer(wire)}")
        2, 4 -> output.appendLine("signal.$number=${reader.text(wire)}")
        else -> reader.skip(wire)
      }
    }
  }

  private fun appendCause(reader: ProtoReader, output: StringBuilder) {
    reader.fields { number, wire ->
      when (number) {
        1 -> output.appendLine("cause=${reader.text(wire)}")
        2 -> appendMemoryError(reader.message(wire), output)
        else -> reader.skip(wire)
      }
    }
  }

  private fun appendMemoryError(reader: ProtoReader, output: StringBuilder) {
    reader.fields { number, wire ->
      when (number) {
        1, 2 -> output.appendLine("memoryError.$number=${reader.integer(wire)}")
        3 -> appendHeap(reader.message(wire), output)
        else -> reader.skip(wire)
      }
    }
  }

  private fun appendHeap(reader: ProtoReader, output: StringBuilder) {
    reader.fields { number, wire ->
      when (number) {
        1, 2, 3, 5 -> output.appendLine("heap.$number=${reader.integer(wire)}")
        4, 6 -> { output.append(if (number == 4) "allocation " else "deallocation "); appendFrame(reader.message(wire), output) }
        else -> reader.skip(wire)
      }
    }
  }

  private fun appendThreadEntry(reader: ProtoReader, output: StringBuilder) {
    reader.fields { number, wire ->
      if (number == 2) appendThread(reader.message(wire), output) else reader.skip(wire)
    }
  }

  private fun appendThread(reader: ProtoReader, output: StringBuilder) {
    output.appendLine("Thread:")
    reader.fields { number, wire ->
      when (number) {
        1 -> output.appendLine("tid=${reader.integer(wire)}")
        2, 7, 9 -> output.appendLine("thread.$number=${reader.text(wire)}")
        4 -> appendFrame(reader.message(wire), output)
        else -> reader.skip(wire)
      }
    }
  }

  private fun appendFrame(reader: ProtoReader, output: StringBuilder) {
    reader.fields { number, wire ->
      when (number) {
        1, 2, 3, 5, 7 -> output.append("${mapOf(1 to "relPc", 2 to "pc", 3 to "sp", 5 to "functionOffset", 7 to "fileMapOffset")[number]}=${reader.integer(wire)} ")
        4, 6, 8 -> output.append("${mapOf(4 to "function", 6 to "file", 8 to "buildId")[number]}=${reader.text(wire)} ")
        else -> reader.skip(wire)
      }
    }
    output.appendLine()
  }

  private class ProtoReader(private val input: InputStream) {
    fun fields(consume: (Int, Int) -> Unit) {
      while (true) {
        val first = input.read()
        if (first == -1) return
        val tag = varint(first)
        require(tag > 0 && tag ushr 3 <= 536_870_911) { "Invalid tombstone field" }
        consume((tag ushr 3).toInt(), (tag and 7).toInt())
      }
    }
    fun integer(wire: Int): Long { require(wire == 0) { "Invalid tombstone integer" }; return varint(input.read()) }
    fun text(wire: Int): String = String(bytes(wire), Charsets.UTF_8)
    fun message(wire: Int): ProtoReader = ProtoReader(ByteArrayInputStream(bytes(wire)))
    private fun bytes(wire: Int): ByteArray {
      require(wire == 2) { "Invalid tombstone message" }
      val size = length()
      val data = ByteArray(size)
      var offset = 0
      while (offset < size) {
        val count = input.read(data, offset, size - offset)
        if (count < 0) throw EOFException("Incomplete tombstone message")
        offset += count
      }
      return data
    }
    private fun length(): Int {
      val value = varint(input.read())
      require(value in 0..Int.MAX_VALUE.toLong()) { "Tombstone field exceeds the platform array contract" }
      return value.toInt()
    }
    fun skip(wire: Int) {
      when (wire) {
        0 -> { varint(input.read()); return }
        1 -> skipBytes(8)
        2 -> skipBytes(length())
        5 -> skipBytes(4)
        else -> error("Unsupported tombstone wire type")
      }
    }
    private fun skipBytes(size: Int) {
      var remaining = size.toLong()
      while (remaining > 0) {
        val skipped = input.skip(remaining)
        if (skipped > 0) remaining -= skipped
        else { if (input.read() == -1) throw EOFException("Incomplete tombstone field"); remaining-- }
      }
    }
    private fun varint(first: Int): Long {
      if (first == -1) throw EOFException("Incomplete tombstone varint")
      var value = 0L
      var byte = first
      for (shift in 0..63 step 7) {
        if (shift == 63) require(byte <= 1) { "Invalid tombstone varint" }
        value = value or ((byte and 127).toLong() shl shift)
        if (byte and 128 == 0) return value
        byte = input.read()
        if (byte == -1) throw EOFException("Incomplete tombstone varint")
      }
      error("Invalid tombstone varint")
    }
  }
}
