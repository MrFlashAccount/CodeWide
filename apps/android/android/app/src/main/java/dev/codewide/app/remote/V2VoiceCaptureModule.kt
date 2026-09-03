package dev.codewide.app.remote

import android.Manifest
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.util.Base64
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import dev.codewide.app.rendering.VoiceAuraRenderEffect
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.UUID
import kotlin.concurrent.thread
import kotlin.math.sqrt

private data class PendingV2VoiceCapture(
  val captureId: String,
  val generation: Long,
  val promise: Promise,
  val token: String,
)

private class PreparedV2VoiceCapture(
  val captureId: String,
  val generation: Long,
  val token: String,
  val promise: Promise,
  var settled: Boolean = false,
)

private data class StoppedV2VoiceCapture(
  val recorder: V2VoiceRecorderLease?,
  val activeToken: String?,
  val pending: PendingV2VoiceCapture?,
  val prepared: PreparedV2VoiceCapture?,
)

/** Captures bounded PCM and drives the local aura; the Voice protocol and network lifecycle remain outside native code. */
class V2VoiceCaptureModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  @Volatile private var active = false
  private var generation = 0L
  private var recorder: V2VoiceRecorderLease? = null
  private var activeToken: String? = null
  private var pendingStart: PendingV2VoiceCapture? = null
  private var preparedCapture: PreparedV2VoiceCapture? = null
  private val voiceAura = VoiceAuraRenderEffect(context)

  override fun getName(): String = "CodeWideV2VoiceCapture"

  @ReactMethod
  fun prepare(captureId: String, promise: Promise) {
    if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
      promise.reject("MIC_PERMISSION", "Microphone permission is required")
      return
    }
    try {
      require(captureId.isNotBlank() && captureId.length <= 256) { "Voice capture id is invalid" }
      stopInternal()
      val token = UUID.randomUUID().toString()
      val prepared = synchronized(this) {
        generation += 1
        PreparedV2VoiceCapture(captureId, generation, token, promise).also { preparedCapture = it }
      }
      V2VoiceCaptureForegroundService.acquire(context, token) { error ->
        if (error === null) completePreparation(prepared) else failPreparation(prepared, error)
      }
    } catch (error: Throwable) {
      stopInternal()
      deactivateVoiceAura()
      promise.reject("V2_VOICE_CAPTURE_FAILED", error.message, error)
    }
  }

  @ReactMethod
  fun start(captureId: String, promise: Promise) {
    val pending = try {
      synchronized(this) {
        val prepared = preparedCapture
          ?: error("Voice capture foreground ownership is unavailable")
        require(prepared.captureId == captureId && prepared.generation == generation) {
          "Voice capture preparation is stale"
        }
        preparedCapture = null
        PendingV2VoiceCapture(captureId, prepared.generation, promise, prepared.token).also {
          pendingStart = it
        }
      }
    } catch (error: Throwable) {
      stopInternal()
      promise.reject("V2_VOICE_CAPTURE_FAILED", error.message, error)
      return
    }
    beginCapture(pending)
  }

  @ReactMethod fun stop() = stopInternal()
  @ReactMethod fun finishAura() = deactivateVoiceAura()
  @ReactMethod fun addListener(eventName: String) = Unit
  @ReactMethod fun removeListeners(count: Double) = Unit

  override fun invalidate() {
    stopInternal()
    context.runOnUiQueueThread { voiceAura.clear() }
    super.invalidate()
  }

  private fun completePreparation(prepared: PreparedV2VoiceCapture) {
    val ownsPreparation = synchronized(this) {
      if (preparedCapture !== prepared || generation != prepared.generation) false else {
        prepared.settled = true
        true
      }
    }
    if (ownsPreparation) prepared.promise.resolve(null) else V2VoiceCaptureForegroundService.release(prepared.token)
  }

  private fun failPreparation(
    prepared: PreparedV2VoiceCapture,
    error: Throwable,
  ) {
    val ownsPreparation = synchronized(this) {
      if (preparedCapture !== prepared) false else {
        preparedCapture = null
        prepared.settled = true
        generation += 1
        true
      }
    }
    if (ownsPreparation) prepared.promise.reject("V2_VOICE_CAPTURE_FAILED", error.message, error)
  }

  private fun beginCapture(pending: PendingV2VoiceCapture) {
    val ownsStart = synchronized(this) {
      if (pendingStart !== pending || generation != pending.generation) false else {
        pendingStart = null
        true
      }
    }
    if (!ownsStart) {
      V2VoiceCaptureForegroundService.release(pending.token)
      return
    }
    var lease: V2VoiceRecorderLease? = null
    try {
      val minimum = AudioRecord.getMinBufferSize(
        SAMPLE_RATE,
        AudioFormat.CHANNEL_IN_MONO,
        AudioFormat.ENCODING_PCM_16BIT,
      )
      check(minimum > 0) { "Microphone buffer is unavailable" }
      val created = AudioRecord(
        MediaRecorder.AudioSource.VOICE_RECOGNITION,
        SAMPLE_RATE,
        AudioFormat.CHANNEL_IN_MONO,
        AudioFormat.ENCODING_PCM_16BIT,
        maxOf(minimum, SAMPLES_PER_CHUNK * 2),
      )
      val createdLease = V2VoiceRecorderLease(
        stopAction = { created.stop() },
        releaseAction = { created.release() },
      )
      lease = createdLease
      check(created.state == AudioRecord.STATE_INITIALIZED) { "Microphone could not be initialized" }
      val ownsGeneration = synchronized(this) {
        if (generation != pending.generation) false else {
          active = true
          recorder = createdLease
          activeToken = pending.token
          true
        }
      }
      check(ownsGeneration) { "Voice capture start was cancelled" }
      created.startRecording()
      updateVoiceAura(pending.generation, 0.0)
      thread(name = "CodeWideV2VoiceCapture", isDaemon = true) {
        capture(pending, created, createdLease)
      }
      pending.promise.resolve(Arguments.createMap().apply {
        putInt("sampleRate", SAMPLE_RATE)
        putInt("numChannels", 1)
      })
    } catch (error: Throwable) {
      synchronized(this) {
        if (generation == pending.generation) {
          generation += 1
          active = false
          recorder = null
          activeToken = null
        }
      }
      lease?.release()
      V2VoiceCaptureForegroundService.release(pending.token)
      deactivateVoiceAura()
      pending.promise.reject("V2_VOICE_CAPTURE_FAILED", error.message, error)
    }
  }

  private fun capture(pending: PendingV2VoiceCapture, source: AudioRecord, lease: V2VoiceRecorderLease) {
    val samples = ShortArray(SAMPLES_PER_CHUNK)
    try {
      while (active && generation == pending.generation) {
        val count = source.read(samples, 0, samples.size, AudioRecord.READ_BLOCKING)
        if (count <= 0) break
        val level = voiceRmsLevel(samples, count)
        updateVoiceAura(pending.generation, level)
        val bytes = ByteBuffer.allocate(count * 2).order(ByteOrder.LITTLE_ENDIAN)
        for (index in 0 until count) bytes.putShort(samples[index])
        emit(Arguments.createMap().apply {
          putString("captureId", pending.captureId)
          putString("type", "batch")
          putInt("sampleRate", SAMPLE_RATE)
          putInt("numChannels", 1)
          putInt("samplesPerChannel", count)
          putDouble("level", level)
          putString("data", Base64.encodeToString(bytes.array(), Base64.NO_WRAP))
        })
      }
    } finally {
      val stoppedCurrent = synchronized(this) {
        if (generation == pending.generation) {
          active = false
          recorder = null
          activeToken = null
          true
        } else {
          false
        }
      }
      if (stoppedCurrent) deactivateVoiceAura()
      lease.release()
      V2VoiceCaptureForegroundService.release(pending.token)
      emit(Arguments.createMap().apply {
        putString("captureId", pending.captureId)
        putString("type", "stopped")
      })
    }
  }

  private fun stopInternal() {
    val stopped = synchronized(this) {
      active = false
      generation += 1
      val value = StoppedV2VoiceCapture(recorder, activeToken, pendingStart, preparedCapture)
      recorder = null
      activeToken = null
      pendingStart = null
      preparedCapture = null
      value
    }
    stopped.recorder?.stop()
    stopped.activeToken?.let(V2VoiceCaptureForegroundService::release)
    if (stopped.pending !== null) {
      V2VoiceCaptureForegroundService.release(stopped.pending.token)
      stopped.pending.promise.reject("V2_VOICE_CAPTURE_CANCELLED", "Voice capture start was cancelled")
    }
    stopped.prepared?.token?.let(V2VoiceCaptureForegroundService::release)
    if (stopped.prepared?.settled == false) {
      stopped.prepared.promise.reject("V2_VOICE_CAPTURE_CANCELLED", "Voice capture preparation was cancelled")
    }
    if (stopped.recorder != null) holdVoiceAura()
    else if (stopped.pending != null || stopped.prepared != null) deactivateVoiceAura()
  }

  private fun updateVoiceAura(current: Long, level: Double) {
    context.runOnUiQueueThread {
      val ownsCapture = synchronized(this) { active && generation == current }
      if (ownsCapture) voiceAura.update(true, level, false)
    }
  }

  private fun deactivateVoiceAura() {
    context.runOnUiQueueThread { voiceAura.update(false, 0.0, false) }
  }

  private fun holdVoiceAura() {
    context.runOnUiQueueThread { voiceAura.update(true, 0.0, false) }
  }

  private fun emit(payload: com.facebook.react.bridge.WritableMap) {
    context.runOnUiQueueThread {
      if (context.hasActiveReactInstance()) {
        context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit(EVENT, payload)
      }
    }
  }

  private companion object {
    const val EVENT = "codewideV2VoiceCapture"
    const val SAMPLE_RATE = 48_000
    const val SAMPLES_PER_CHUNK = 4_800
  }
}

internal fun voiceRmsLevel(samples: ShortArray, count: Int): Double {
  if (count <= 0 || count > samples.size) return 0.0
  var sumOfSquares = 0.0
  for (index in 0 until count) {
    val sample = samples[index].toDouble()
    sumOfSquares += sample * sample
  }
  return (sqrt(sumOfSquares / count) / 32_768.0).coerceIn(0.0, 1.0)
}
