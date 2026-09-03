package dev.codewide.app.remote

import java.io.BufferedInputStream
import java.io.ByteArrayInputStream
import java.nio.charset.StandardCharsets
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.assertThrows
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

class NativePortForwardManagerTest {
  private val localCapability = "a".repeat(43)

  @Test
  fun derivesSecurePortForwardEndpointFromSyncEndpoint() {
    assertEquals(
      "wss://codex.example.test/v2/ports/3000",
      NativePortForwardManager.portForwardEndpoint("wss://codex.example.test/v1/sync", 3000),
    )
    assertEquals(
      "wss://codex.example.test/v2/ports/3000",
      NativePortForwardManager.portForwardEndpoint("wss://codex.example.test/v2/sync", 3000),
    )
  }

  @Test
  fun preservesLocalDevelopmentEndpointAuthority() {
    assertEquals(
      "ws://10.0.2.2:8765/v2/ports/8080",
      NativePortForwardManager.portForwardEndpoint("ws://10.0.2.2:8765/v1/sync", 8080),
    )
  }

  @Test
  fun derivesHttpDiscoveryEndpointFromSyncEndpoint() {
    assertEquals(
      "https://codex.example.test/v2/ports",
      NativePortForwardManager.portDiscoveryEndpoint("wss://codex.example.test/v1/sync"),
    )
    assertEquals(
      "http://10.0.2.2:8765/v2/ports",
      NativePortForwardManager.portDiscoveryEndpoint("ws://10.0.2.2:8765/v1/sync"),
    )
    assertEquals(
      "https://codex.example.test/v2/ports",
      NativePortForwardManager.portDiscoveryEndpoint("wss://codex.example.test/v2/sync"),
    )
  }

  @Test
  fun rejectsInvalidEndpointAndPort() {
    assertThrows(IllegalStateException::class.java) {
      NativePortForwardManager.portForwardEndpoint("wss://codex.example.test/not-sync", 3000)
    }
    assertThrows(IllegalArgumentException::class.java) {
      NativePortForwardManager.portForwardEndpoint("wss://codex.example.test/v1/sync", 0)
    }
  }

  @Test
  fun unavailableForwardDoesNotExposeADeadPreviewUrl() {
    val profile = StoredPortForward(
      id = "forward-test",
      connectionId = "server-test",
      label = "Vite",
      remotePort = 4_173,
      preferredLocalPort = null,
      serviceKey = "a".repeat(64),
      preference = "automatic",
      enabled = true,
      updatedAt = 1,
    )

    val projection = PortForwardProjection(
      profile = profile,
      localPort = 46_213,
      status = "unavailable",
      error = "Nothing is listening on remote localhost:4173",
    ).json()

    assertTrue(projection.isNull("previewUrl"))
    assertEquals("unavailable", projection.getString("status"))
  }

  @Test
  fun manualProfileNeedsNoFingerprintButDiscoveredIdentityCannotChange() {
    val profile = portForwardProfile()
    val current = mapOf(profile.remotePort to "a".repeat(64))

    assertNull(NativePortForwardManager.portAvailabilityError(profile.copy(
      serviceKey = null,
      identityMode = PortForwardIdentityMode.MANUAL,
    ), current))
    assertTrue(
      NativePortForwardManager.portAvailabilityError(profile.copy(serviceKey = "b".repeat(64)), current)
        ?.contains("has changed") == true,
    )
    assertNull(NativePortForwardManager.portAvailabilityError(profile, current))
  }

  @Test
  fun discoveredProfileCannotSilentlyDowngradeToManual() {
    assertFalse(
      portForwardIdentityTransitionAllowed(
        PortForwardIdentityMode.DISCOVERED,
        PortForwardIdentityMode.MANUAL,
      ),
    )
    assertTrue(
      portForwardIdentityTransitionAllowed(
        PortForwardIdentityMode.MANUAL,
        PortForwardIdentityMode.MANUAL,
      ),
    )
    assertTrue(
      portForwardIdentityTransitionAllowed(
        PortForwardIdentityMode.DISCOVERED,
        PortForwardIdentityMode.DISCOVERED,
      ),
    )
    assertThrows(IllegalArgumentException::class.java) {
      NativePortForwardStore.validate(portForwardProfile().copy(serviceKey = null))
    }
  }

  @Test
  fun credentialLocksAreReusableAndCanBeClearedWithTheirServer() {
    val registry = CredentialLockRegistry()
    val first = registry.lockFor("server-one")

    assertTrue(first === registry.lockFor("server-one"))
    registry.lockFor("server-two")
    assertEquals(2, registry.size())

    registry.remove("server-one")
    assertEquals(1, registry.size())
    assertFalse(first === registry.lockFor("server-one"))
    registry.clear()
    assertEquals(0, registry.size())
  }

  @Test
  fun liveForwardExposesOnlyAnUnguessableCapabilityUrl() {
    val profile = portForwardProfile()
    val projection = PortForwardProjection(
      profile = profile,
      localPort = 46_213,
      status = "live",
      error = null,
      localCapability = localCapability,
    ).json()

    assertEquals("http://127.0.0.1:46213/$localCapability/", projection.getString("previewUrl"))
  }

  @Test
  fun httpCapabilityIsStrippedBeforeBytesReachTheRemoteService() {
    val request =
      "GET /$localCapability/app?q=1 HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\nbody"
    val authorized = PortForwardLocalAuthorization.authenticate(
      buffered(request),
      localCapability,
    )

    assertEquals(
      "GET /app?q=1 HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n",
      authorized.initialPayload.toString(StandardCharsets.ISO_8859_1),
    )
    assertEquals("body", authorized.input.readBytes().toString(StandardCharsets.ISO_8859_1))
    assertFalse(authorized.initialPayload.toString(StandardCharsets.ISO_8859_1).contains(localCapability))
  }

  @Test
  fun headerAndGenericPrefaceAuthenticateWithoutLeakingTheCapability() {
    val header = PortForwardLocalAuthorization.authenticate(
      buffered(
        "GET /app HTTP/1.1\r\nX-CodeWide-Local-Capability: $localCapability\r\n\r\n",
      ),
      localCapability,
    )
    val generic = PortForwardLocalAuthorization.authenticate(
      buffered("CODEWIDE/1 $localCapability\r\npayload"),
      localCapability,
    )

    assertEquals("GET /app HTTP/1.1\r\n\r\n", header.initialPayload.toString(StandardCharsets.ISO_8859_1))
    assertEquals(0, generic.initialPayload.size)
    assertEquals("payload", generic.input.readBytes().toString(StandardCharsets.ISO_8859_1))
  }

  @Test
  fun rejectsConflictingCapabilityEvenWhenThePathCapabilityIsValid() {
    assertThrows(IllegalStateException::class.java) {
      PortForwardLocalAuthorization.authenticate(
        buffered(
          "GET /$localCapability/app HTTP/1.1\r\n" +
            "X-CodeWide-Local-Capability: ${"b".repeat(43)}\r\n\r\n",
        ),
        localCapability,
      )
    }
  }

  @Test
  fun unauthenticatedLocalSocketCannotAllocateOrTouchUpstream() {
    var upstreamConnections = 0
    var upstreamBytes = 0

    assertThrows(IllegalStateException::class.java) {
      PortForwardLocalAuthorization.authenticateBeforeUpstream(
        buffered("GET /private HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n"),
        localCapability,
      ) {
        upstreamConnections += 1
        upstreamBytes += it.initialPayload.size
      }
    }

    assertEquals(0, upstreamConnections)
    assertEquals(0, upstreamBytes)
  }

  @Test
  fun blockedStartCannotInstallAfterStopRevokesItsGeneration() {
    val gate = PortForwardStartGate()
    val permit = gate.begin("forward-test")
    val bindCompleted = CountDownLatch(1)
    val allowInstall = CountDownLatch(1)
    val finished = CountDownLatch(1)
    var enabled = true
    var installed = false
    thread(name = "blocked-port-bind") {
      bindCompleted.countDown()
      allowInstall.await()
      gate.runIfCurrent(permit) { installed = true }
      finished.countDown()
    }

    assertTrue(bindCompleted.await(1, TimeUnit.SECONDS))
    gate.revoke("forward-test") { enabled = false }
    allowInstall.countDown()
    assertTrue(finished.await(1, TimeUnit.SECONDS))

    assertFalse(enabled)
    assertFalse(installed)
    assertFalse(gate.isCurrent(permit))
  }

  @Test
  fun blockedStartCannotRestoreRemovedProfile() {
    val gate = PortForwardStartGate()
    val permit = gate.begin("forward-test")
    var profileExists = true

    gate.revoke("forward-test") { profileExists = false }
    val installed = gate.runIfCurrent(permit) { profileExists = true }

    assertFalse(installed)
    assertFalse(profileExists)
    assertFalse(gate.isCurrent(permit))
  }

  @Test
  fun blockedStartCannotInstallAfterManagerClose() {
    val gate = PortForwardStartGate()
    val permit = gate.begin("forward-test")

    gate.close()

    assertFalse(gate.runIfCurrent(permit) { error("closed generation must not run") })
    assertFalse(gate.isCurrent(permit))
  }

  private fun portForwardProfile(): StoredPortForward = StoredPortForward(
    id = "forward-test",
    connectionId = "server-test",
    label = "Vite",
    remotePort = 4_173,
    preferredLocalPort = null,
    serviceKey = "a".repeat(64),
    preference = "automatic",
    enabled = true,
    updatedAt = 1,
  )

  private fun buffered(value: String): BufferedInputStream = BufferedInputStream(
    ByteArrayInputStream(value.toByteArray(StandardCharsets.ISO_8859_1)),
  )
}
