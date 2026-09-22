package dev.codewide.app.remote

import android.app.Activity
import android.os.Handler
import android.os.Looper
import dev.codewide.app.rendering.VoiceAssistantOrbState as State
import java.time.Duration
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.LooperMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], manifest = Config.NONE)
@LooperMode(LooperMode.Mode.PAUSED)
class GlobalVoiceWebRtcObserverTest {
  private class Source : GlobalVoicePeerSource {
    lateinit var connection: (State) -> Unit
    lateinit var event: (String) -> Unit
    val pending = mutableListOf<(Double) -> Unit>()
    var unsubscribed = 0
    override fun subscribe(onConnection: (State) -> Unit, onEvent: (String) -> Unit): () -> Unit {
      connection = onConnection
      event = onEvent
      return { unsubscribed += 1 }
    }
    override fun requestPlayback(accept: (Double) -> Unit) { pending.add(accept) }
  }

  @Test fun livePeerPublishesSpeechAndPlaybackAcrossActivityBackgroundAndForeground() {
    val source = Source()
    val main = shadowOf(Looper.getMainLooper())
    val owner = GlobalVoicePresentationOwner { android.os.SystemClock.elapsedRealtime() }
    val levels = mutableListOf<GlobalVoiceAudioLevels>()
    val audio = GlobalVoiceAudioLevelOwner({ it() }, { android.os.SystemClock.elapsedRealtimeNanos() }, levels::add)
    audio.setActive(true)
    val states = mutableListOf<State>()
    val observer = GlobalVoiceWebRtcObserver(1, source, Handler(Looper.getMainLooper()),
      { state -> if (state == State.LISTENING) owner.connected() else owner.acceptPhase(state) },
      { type -> owner.acceptEvent(type); states.add(owner.state()) },
      { level -> owner.acceptPlayback(level); audio.acceptPlaybackLevel(level); states.add(owner.state()) },
    )
    val activity = Robolectric.buildActivity(Activity::class.java).setup()
    source.connection(State.LISTENING)
    main.idle()
    activity.pause().stop()
    source.event("response.created")
    main.idle()
    assertEquals(State.THINKING, states.last())
    source.pending.removeAt(0)(0.7)
    main.idle()
    assertEquals(State.SPEAKING, states.last())
    assertEquals(0.7, levels.last().playback, 0.0)
    // Polling continues with no mounted screen, JS timer, or Activity callback.
    main.idleFor(Duration.ofMillis(100))
    assertEquals(1, source.pending.size)
    source.event("input_audio_buffer.speech_started")
    audio.acceptInputPcm(android.media.AudioFormat.ENCODING_PCM_16BIT, 1, 48_000, byteArrayOf(0, 64))
    source.pending.removeAt(0)(0.4)
    main.idle()
    assertEquals(State.LISTENING, states.last())
    assertEquals(0.5, levels.last().input, 0.0001)
    activity.start().resume()
    source.event("input_audio_buffer.speech_stopped")
    main.idle()
    assertEquals(State.THINKING, states.last())
    main.idleFor(Duration.ofMillis(100))
    source.pending.removeAt(0)(0.8)
    main.idle()
    assertEquals(State.SPEAKING, states.last())
    assertEquals(0.8, levels.last().playback, 0.0)
    observer.close()
    audio.setActive(false)
    activity.pause().stop().destroy()
  }

  @Test fun stopUnsubscribesOnceAndDiscardsQueuedEventsAndInflightStats() {
    val source = Source()
    val main = shadowOf(Looper.getMainLooper())
    val states = mutableListOf<State>()
    val events = mutableListOf<String>()
    val levels = mutableListOf<Double>()
    val observer = GlobalVoiceWebRtcObserver(2, source, Handler(Looper.getMainLooper()),
      states::add, events::add, levels::add)
    source.connection(State.LISTENING)
    source.event("input_audio_buffer.speech_started")
    observer.close()
    observer.close()
    source.pending.removeAt(0)(1.0)
    main.idleFor(Duration.ofSeconds(1))
    assertEquals(1, source.unsubscribed)
    assertTrue(states.isEmpty())
    assertTrue(events.isEmpty())
    assertTrue(levels.isEmpty())
    assertTrue(source.pending.isEmpty())
  }
}
