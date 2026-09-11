package dev.codewide.app.rendering

import java.security.MessageDigest

/** Bounded paint-only history: recycling must not replay a finished media reveal. */
internal object RevealHistory {
  private val completed = linkedSetOf<String>()

  // Keys can contain diagram source. Retain a fixed-size digest, never the source itself.
  fun key(value: String): String {
    val digest = MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8))
    return buildString(64) {
      for (byte in digest) {
        val value = byte.toInt() and 255
        append("0123456789abcdef"[value ushr 4])
        append("0123456789abcdef"[value and 15])
      }
    }
  }

  fun contains(key: String): Boolean = key in completed

  fun record(key: String) {
    completed.remove(key)
    completed.add(key)
    while (completed.size > 128) completed.remove(completed.first())
  }
}
