package dev.codewide.app.remote

import android.Manifest
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.media.audiofx.AutomaticGainControl
import android.media.audiofx.NoiseSuppressor
import android.os.Build
import android.os.SystemClock
import android.util.Log
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.ReactApplicationContext
import java.util.concurrent.CompletableFuture
import java.util.concurrent.Executors

/** Owns only the idle recorder. Active capture takes ownership until it releases the session. */
internal class PreparedMicrophone(private val context: ReactApplicationContext) {
  data class Source(val value: Int, val label: String)
  data class Session(
    val recorder: AudioRecord,
    val source: Source,
    val sampleRate: Int,
    val noiseSuppressor: NoiseSuppressor?,
    val automaticGainControl: AutomaticGainControl?,
  ) {
    fun release() {
      noiseSuppressor?.release()
      automaticGainControl?.release()
      recorder.release()
    }
  }

  private val executor = Executors.newSingleThreadExecutor { task -> Thread(task, "CodeWideMicPrepare").apply { isDaemon = true } }
  private var pending: CompletableFuture<Session>? = null
  private var enabled = false
  private var foreground = false
  private var activeCaptures = 0
  private var platformRecognition = false
  private var closed = false

  fun hasPermission(): Boolean = ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

  @Synchronized fun setEnabled(value: Boolean) { enabled = value; refresh() }
  @Synchronized fun setForeground(value: Boolean) { foreground = value; refresh() }
  @Synchronized fun captureReleased() { activeCaptures -= 1; refresh() }
  @Synchronized fun setPlatformRecognition(active: Boolean) { platformRecognition = active; refresh() }

  @Synchronized fun refresh() {
    if (closed || !enabled || !foreground || platformRecognition || !hasPermission()) {
      releasePending()
      return
    }
    if (activeCaptures > 0 || pending != null) return
    pending = CompletableFuture.supplyAsync({ buildFirstAvailable() }, executor)
  }

  fun start(): Session {
    val startedAt = SystemClock.elapsedRealtime()
    val prepared = synchronized(this) {
      check(!closed && hasPermission()) { "Microphone permission is required" }
      activeCaptures += 1
      val value = pending
      pending = null
      value
    }
    val candidate = try { prepared?.get() } catch (error: Exception) {
      Log.w(TAG, "Microphone preparation failed; retrying capture", error)
      null
    }
    if (candidate != null) {
      try {
        candidate.recorder.startRecording()
        Log.i(TAG, "Microphone start prepared=true durationMs=${SystemClock.elapsedRealtime() - startedAt}")
        return candidate
      } catch (error: Exception) {
        Log.w(TAG, "Prepared microphone could not start; probing capture sources", error)
        candidate.release()
      }
    }
    for (source in SOURCES) {
      var session: Session? = null
      try {
        session = build(source)
        session.recorder.startRecording()
        Log.i(TAG, "Microphone start prepared=false durationMs=${SystemClock.elapsedRealtime() - startedAt}")
        return session
      } catch (error: Exception) {
        session?.release()
        Log.w(TAG, "Microphone source ${source.label} unavailable", error)
      }
    }
    synchronized(this) { activeCaptures -= 1 }
    error("No supported microphone capture source")
  }

  @Synchronized fun close() {
    closed = true
    releasePending()
    executor.shutdown()
  }

  private fun releasePending() {
    val abandoned = pending
    pending = null
    // Do not cancel a running constructor: its eventual AudioRecord still needs releasing.
    abandoned?.thenAccept { it.release() }
  }

  private fun buildFirstAvailable(): Session {
    for (source in SOURCES) {
      try { return build(source) } catch (error: Exception) {
        Log.w(TAG, "Microphone source ${source.label} could not prepare", error)
      }
    }
    error("No supported microphone capture source")
  }

  private fun build(source: Source): Session {
    val startedAt = SystemClock.elapsedRealtime()
    check(hasPermission()) { "Microphone permission is required" }
    val builder = AudioRecord.Builder().setAudioSource(source.value)
      .setAudioFormat(AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT)
        .setChannelMask(AudioFormat.CHANNEL_IN_MONO).setSampleRate(48_000).build())
      .setBufferSizeInBytes(38_400)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) builder.setPrivacySensitive(true)
    val recorder = builder.build()
    try {
      check(recorder.state == AudioRecord.STATE_INITIALIZED) { "Microphone could not be initialized" }
      val noise = try { if (!NoiseSuppressor.isAvailable()) null else NoiseSuppressor.create(recorder.audioSessionId)?.apply { if (hasControl()) enabled = true } }
        catch (error: Exception) { Log.w(TAG, "Noise suppression unavailable", error); null }
      val gain = try { if (!AutomaticGainControl.isAvailable()) null else AutomaticGainControl.create(recorder.audioSessionId)?.apply { if (hasControl()) enabled = true } }
        catch (error: Exception) { Log.w(TAG, "Automatic gain unavailable", error); null }
      Log.i(TAG, "Microphone prepare source=${source.label} durationMs=${SystemClock.elapsedRealtime() - startedAt}")
      return Session(recorder, source, recorder.sampleRate, noise, gain)
    } catch (error: Exception) {
      recorder.release()
      throw error
    }
  }

  companion object {
    private const val TAG = "CodeWideAudio"
    private val SOURCES = listOf(
      Source(MediaRecorder.AudioSource.VOICE_COMMUNICATION, "voice_communication"),
      Source(MediaRecorder.AudioSource.VOICE_RECOGNITION, "voice_recognition"),
      Source(MediaRecorder.AudioSource.MIC, "mic"),
    )
  }
}
