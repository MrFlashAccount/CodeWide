package dev.codewide.app.remote

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class V2ForegroundSyncChannelsTest {
  @Test
  fun runtimeHandoffKeepsExactlyOneSocketPerSavedServer() {
    val channels = V2ForegroundSyncChannels()
    val previous = V2ForegroundSyncChannel("lease-old", "socket-old")
    val replacement = V2ForegroundSyncChannel("lease-new", "socket-new")

    assertNull(channels.replace("server-a", previous))
    assertEquals(previous, channels.replace("server-a", replacement))
    assertEquals(1, channels.size())
    assertEquals(setOf("server-a"), channels.servers())
  }

  @Test
  fun lateCloseFromSupersededRuntimeCannotRetireTheReplacement() {
    val channels = V2ForegroundSyncChannels()
    val previous = V2ForegroundSyncChannel("lease-old", "socket-old")
    val replacement = V2ForegroundSyncChannel("lease-new", "socket-new")
    channels.replace("server-a", previous)
    channels.replace("server-a", replacement)

    assertNull(channels.remove(previous))
    assertTrue(channels.hasServer("server-a"))
    assertEquals("server-a", channels.remove(replacement))
    assertFalse(channels.hasServer("server-a"))
  }

  @Test
  fun releasingOneLeaseDoesNotRemoveAnotherServersSocket() {
    val channels = V2ForegroundSyncChannels()
    channels.replace("server-a", V2ForegroundSyncChannel("lease-a", "socket-a"))
    channels.replace("server-b", V2ForegroundSyncChannel("lease-b", "socket-b"))

    assertEquals(setOf("server-a"), channels.removeHandle("lease-a"))
    assertFalse(channels.hasServer("server-a"))
    assertTrue(channels.hasServer("server-b"))
  }
}
