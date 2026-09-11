package dev.codewide.app.rendering

/** The first visible frame is a baseline, not a batch of newly received text. */
internal class StreamingRevealSession {
  private var presented = false
  private var clock = StreamingRevealClock()

  fun createState(textLength: Int, animateNew: Boolean): StreamingRevealState =
    StreamingRevealState(if (presented && animateNew) 0 else textLength, clock)

  fun didPresentText() { presented = true }

  fun reset() {
    presented = false
    clock = StreamingRevealClock()
  }
}
