package dev.codewide.app.remote

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class DeviceKeyStoreTest {
  @Test
  fun `saved servers receive stable isolated keystore aliases`() {
    val firstId = "saved-server-11111111-1111-1111-1111-111111111111"
    val secondId = "saved-server-22222222-2222-2222-2222-222222222222"
    val firstAlias = connectionIdentityAlias(firstId)

    assertEquals(firstAlias, connectionIdentityAlias(firstId))
    assertNotEquals(firstAlias, connectionIdentityAlias(secondId))
    assertTrue(firstAlias.matches(Regex("^codex_remote_connection_identity_v3_[a-f0-9]{64}$")))
    assertFalse(firstAlias.contains(firstId))
  }

  @Test
  fun `blank saved server ids cannot allocate keystore identities`() {
    assertThrows(IllegalArgumentException::class.java) { connectionIdentityAlias(" ") }
  }

  @Test
  fun `pairing proof uses the v2 domain and exact transcript`() {
    assertEquals(
      "codewide-pairing-v2\ntoken\nAndroid Fold\npublic-key",
      String(pairingClaimBytes("token", " Android Fold ", "public-key"), Charsets.UTF_8),
    )
  }
}
