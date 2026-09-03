package dev.codewide.app.remote

import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeAuthorityLifecycleTest {
  @Test
  fun replacementRevokesBeforePublishingAndResuming() {
    val steps = mutableListOf<String>()

    replaceNativeAuthority(
      revoke = { steps += "revoke" },
      persist = { steps += "persist" },
      resume = { steps += "resume" },
    )

    assertEquals(listOf("revoke", "persist", "resume"), steps)
  }

  @Test
  fun failedRevocationCannotPublishOrResumeReplacement() {
    val steps = mutableListOf<String>()

    val failure = runCatching {
      replaceNativeAuthority(
        revoke = {
          steps += "revoke"
          error("revocation failed")
        },
        persist = { steps += "persist" },
        resume = { steps += "resume" },
      )
    }

    assertTrue(failure.isFailure)
    assertEquals(listOf("revoke"), steps)
  }

  @Test
  fun failedPersistenceCannotResumeReplacement() {
    val steps = mutableListOf<String>()

    val failure = runCatching {
      replaceNativeAuthority(
        revoke = { steps += "revoke" },
        persist = {
          steps += "persist"
          error("persistence failed")
        },
        resume = { steps += "resume" },
      )
    }

    assertTrue(failure.isFailure)
    assertEquals(listOf("revoke", "persist"), steps)
  }

  @Test
  fun revocationAttemptsEveryServerScopedCapabilityBeforeFailing() {
    val retired = mutableListOf<String>()

    val failure = runCatching {
      revokeNativeAuthority(
        NativeAuthorityRevocation(
          authenticatedTransports = {
            retired += "authenticated-transports"
            error("lease close failed")
          },
          notificationProjection = { retired += "notification-projection" },
          legacySession = { retired += "legacy-session" },
          portForwards = { retired += "port-forwards" },
          terminalSessions = { retired += "terminal-sessions" },
          httpProxy = { retired += "http-proxy" },
        ),
      )
    }

    assertTrue(failure.isFailure)
    assertEquals(
      listOf(
        "authenticated-transports",
        "notification-projection",
        "legacy-session",
        "port-forwards",
        "terminal-sessions",
        "http-proxy",
      ),
      retired,
    )
  }

  @Test
  fun replacementCannotOverlapServicePublication() {
    val lifecycle = NativeAuthorityLifecycle()
    val firstEntered = CountDownLatch(1)
    val releaseFirst = CountDownLatch(1)
    val secondAttempted = CountDownLatch(1)
    val secondEntered = CountDownLatch(1)
    val steps = Collections.synchronizedList(mutableListOf<String>())

    val publication = Thread {
      lifecycle.access {
        steps += "publication-start"
        firstEntered.countDown()
        assertTrue(releaseFirst.await(2, TimeUnit.SECONDS))
        steps += "publication-end"
      }
    }
    val replacement = Thread {
      assertTrue(firstEntered.await(2, TimeUnit.SECONDS))
      secondAttempted.countDown()
      lifecycle.access {
        steps += "replacement"
        secondEntered.countDown()
      }
    }

    publication.start()
    replacement.start()
    assertTrue(firstEntered.await(2, TimeUnit.SECONDS))
    assertTrue(secondAttempted.await(2, TimeUnit.SECONDS))
    assertFalse(secondEntered.await(100, TimeUnit.MILLISECONDS))
    releaseFirst.countDown()
    publication.join(2_000)
    replacement.join(2_000)

    assertFalse(publication.isAlive)
    assertFalse(replacement.isAlive)
    assertEquals(listOf("publication-start", "publication-end", "replacement"), steps)
  }
}
