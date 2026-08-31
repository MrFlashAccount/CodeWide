package dev.codewide.app.remote

import org.junit.Assert.assertEquals
import org.junit.Test

class V2VoiceRecorderLeaseTest {
  @Test
  fun releasesExactlyOnceAfterExplicitStopAndThreadCleanup() {
    var stops = 0
    var releases = 0
    val lease = V2VoiceRecorderLease(
      stopAction = { stops += 1 },
      releaseAction = { releases += 1 },
    )

    lease.stop()
    lease.release()
    lease.release()

    assertEquals(1, stops)
    assertEquals(1, releases)
  }

  @Test
  fun releasesWhenRecorderStopThrowsDuringStartupFailure() {
    var releases = 0
    val lease = V2VoiceRecorderLease(
      stopAction = { error("stop failed") },
      releaseAction = { releases += 1 },
    )

    lease.release()

    assertEquals(1, releases)
  }
}
