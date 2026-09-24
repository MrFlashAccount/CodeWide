package dev.codewide.app.remote

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeSessionCredentialsStoreTest {
  private val firstDevice = "device-${"a".repeat(64)}"
  private val secondDevice = "device-${"b".repeat(64)}"

  @Test
  fun `confirmed revocation survives profile edits but a new pairing can connect`() {
    val revoked = StoredNativeSession(
      id = "server",
      endpoint = "https://companion.example",
      token = "c".repeat(43),
      tlsPinSha256 = null,
      enabled = false,
      innerTlsPinSha256 = "pin",
      deviceId = firstDevice,
      revocationConfirmed = true,
    )

    val edited = mergeNativeSessionCredentials(
      revoked, revoked.id, revoked.endpoint, revoked.token, null, true,
    )
    assertTrue(edited.revocationConfirmed)
    assertFalse(edited.enabled)

    val pairedAgain = mergeNativeSessionCredentials(
      edited, edited.id, edited.endpoint, edited.token, null, true, secondDevice,
    )
    assertFalse(pairedAgain.revocationConfirmed)
    assertTrue(pairedAgain.enabled)
  }
}
