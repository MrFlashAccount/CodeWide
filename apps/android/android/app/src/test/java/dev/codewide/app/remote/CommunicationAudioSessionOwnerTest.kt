package dev.codewide.app.remote

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CommunicationAudioSessionOwnerTest {
  private class FakeAudioMode(initial: Int) : CommunicationAudioMode {
    var value = initial
    val writes = mutableListOf<Int>()
    var failNextWrite = false

    override fun currentMode(): Int = value

    override fun setMode(value: Int) {
      writes += value
      if (failNextWrite) {
        failNextWrite = false
        error("mode write failed")
      }
      this.value = value
    }
  }

  private class FakeAudioRoute(
    var current: CommunicationAudioDevice?,
    var devices: List<CommunicationAudioDevice>,
  ) : CommunicationAudioRoute {
    val operations = mutableListOf<String>()
    private var observer: (() -> Unit)? = null

    override fun available(): List<CommunicationAudioDevice> = devices

    override fun clear() {
      operations += "clear"
      current = null
    }

    override fun currentDevice(): CommunicationAudioDevice? = current

    override fun select(deviceId: Int): Boolean {
      operations += "select:$deviceId"
      val selected = devices.firstOrNull { it.id == deviceId } ?: return false
      current = selected
      return true
    }

    override fun startObserving(onChanged: () -> Unit) {
      operations += "observe"
      observer = onChanged
    }

    override fun stopObserving() {
      operations += "stopObserving"
      observer = null
    }

    fun publishDeviceChange() = observer?.invoke()
  }

  private fun owner(
    mode: FakeAudioMode,
    route: FakeAudioRoute = FakeAudioRoute(SPEAKER, listOf(EARPIECE, SPEAKER)),
    token: String,
  ): CommunicationAudioSessionOwner = CommunicationAudioSessionOwner(
    mode,
    route,
    7,
    EARPIECE_TYPE,
    { token },
    SPEAKER_TYPE,
  )

  @Test
  fun acquiresCommunicationModeAndRestoresPreviousModeExactlyOnce() {
    val mode = FakeAudioMode(3)
    val owner = owner(mode, token = "session")

    val token = owner.acquire()

    assertEquals("session", token)
    assertEquals(7, mode.value)
    assertTrue(owner.release(token))
    assertFalse(owner.release(token))
    assertEquals(listOf(7, 3), mode.writes)
  }

  @Test
  fun restoresAfterStartupFailureAndDoesNotRetainOwnership() {
    val mode = FakeAudioMode(4).apply { failNextWrite = true }
    val owner = owner(mode, token = "failed")

    runCatching { owner.acquire() }

    assertEquals(listOf(7, 4), mode.writes)
    val token = owner.acquire()
    assertEquals("failed", token)
  }

  @Test
  fun closeRestoresModeForCancellationAndMakesLaterReleaseIdempotent() {
    val mode = FakeAudioMode(5)
    val owner = owner(mode, token = "cancelled")
    val token = owner.acquire()

    owner.close()
    owner.close()

    assertFalse(owner.release(token))
    assertEquals(listOf(7, 5), mode.writes)
  }

  @Test
  fun staleTokenCannotRestoreAnotherSessionsMode() {
    val mode = FakeAudioMode(6)
    val owner = owner(mode, token = "active")
    val token = owner.acquire()

    assertFalse(owner.release("stale"))
    assertEquals(7, mode.value)
    assertTrue(owner.release(token))
    assertEquals(6, mode.value)
  }

  @Test
  fun selectsBuiltInSpeakerAndClearsItWhenReturningToNormalMode() {
    val mode = FakeAudioMode(1)
    val route = FakeAudioRoute(EARPIECE, listOf(EARPIECE, SPEAKER))
    val owner = owner(mode, route, "speaker")

    val token = owner.acquire()

    assertEquals(SPEAKER, route.current)
    assertEquals(listOf("observe", "select:2"), route.operations)

    owner.release(token)

    assertEquals(null, route.current)
    assertEquals(
      listOf("observe", "select:2", "stopObserving", "clear"),
      route.operations,
    )
    assertEquals(listOf(7, 1), mode.writes)
  }

  @Test
  fun restoresThePreviousDeviceWhenItBorrowedAnExistingCommunicationMode() {
    val mode = FakeAudioMode(7)
    val route = FakeAudioRoute(EARPIECE, listOf(EARPIECE, SPEAKER))
    val owner = owner(mode, route, "nested")

    val token = owner.acquire()
    owner.release(token)

    assertEquals(EARPIECE, route.current)
    assertEquals(
      listOf("observe", "select:2", "stopObserving", "select:1"),
      route.operations,
    )
  }

  @Test
  fun preservesAnAvailableExternalCommunicationRoute() {
    val mode = FakeAudioMode(1)
    val headset = CommunicationAudioDevice(8, 30)
    val route = FakeAudioRoute(headset, listOf(EARPIECE, SPEAKER, headset))
    val owner = owner(mode, route, "headset")

    val token = owner.acquire()

    assertEquals(headset, route.current)
    assertEquals(listOf("observe"), route.operations)
    owner.release(token)
    assertEquals(headset, route.current)
    assertEquals(listOf("observe", "stopObserving"), route.operations)
  }

  @Test
  fun yieldsSpeakerSelectionWhenAnExternalRouteAppearsAndRestoresItAfterRemoval() {
    val mode = FakeAudioMode(1)
    val headset = CommunicationAudioDevice(8, 30)
    val route = FakeAudioRoute(EARPIECE, listOf(EARPIECE, SPEAKER))
    val owner = owner(mode, route, "handoff")
    owner.acquire()

    route.devices = listOf(EARPIECE, SPEAKER, headset)
    route.publishDeviceChange()

    assertEquals(null, route.current)
    assertEquals(listOf("observe", "select:2", "clear"), route.operations)

    route.devices = listOf(EARPIECE, SPEAKER)
    route.current = EARPIECE
    route.publishDeviceChange()

    assertEquals(SPEAKER, route.current)
    assertEquals(listOf("observe", "select:2", "clear", "select:2"), route.operations)
  }

  companion object {
    private const val EARPIECE_TYPE = 1
    private const val SPEAKER_TYPE = 2
    private val EARPIECE = CommunicationAudioDevice(1, EARPIECE_TYPE)
    private val SPEAKER = CommunicationAudioDevice(2, SPEAKER_TYPE)
  }
}
