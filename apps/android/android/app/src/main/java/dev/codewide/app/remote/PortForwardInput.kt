package dev.codewide.app.remote

import java.io.InputStream

/** Opaque TCP bytes: no HTTP parsing, URL rewriting or local authentication preface.
 * The sender consumes the borrowed buffer synchronously; false ends the stream.
 */
internal fun copyPortForwardInput(input: InputStream, send: (ByteArray, Int) -> Boolean) {
  val buffer = ByteArray(64 * 1024)
  while (true) {
    val count = input.read(buffer)
    if (count < 0) return
    if (count > 0 && !send(buffer, count)) return
  }
}
