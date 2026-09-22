package dev.codewide.app.remote

import android.Manifest
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.util.UUID
import kotlin.concurrent.thread

/** Records one local voiceprint and exposes gate decisions to the owning WebRTC adapter. */
class PersonalVoiceFilterModule(
  private val context: ReactApplicationContext,
) : ReactContextBaseJavaModule(context) {
  private val runtime = PersonalVoiceFilterRuntime.requireInstalled()
  private var enrollmentGeneration = 0L
  private var enrollmentRecorder: AudioRecord? = null

  override fun getName(): String = "CodeWidePersonalVoiceFilter"

  override fun getConstants(): Map<String, Any> = mapOf("hasProfile" to runtime.hasProfile())

  @ReactMethod
  fun startEnrollment(promise: Promise) {
    if (
      ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) !=
      PackageManager.PERMISSION_GRANTED
    ) {
      promise.reject("MIC_PERMISSION", "Microphone permission is required")
      return
    }
    val generation = synchronized(this) {
      if (enrollmentRecorder != null) {
        promise.reject("VOICE_PROFILE_BUSY", "Voice profile recording is already active")
        return
      }
      enrollmentGeneration += 1
      enrollmentGeneration
    }
    val token = UUID.randomUUID().toString()
    VoiceCaptureForegroundService.acquire(context, token) { error ->
      if (error != null) {
        promise.reject("VOICE_PROFILE_FOREGROUND_FAILED", error.message, error)
        return@acquire
      }
      beginEnrollment(generation, token, promise)
    }
  }

  @ReactMethod
  fun startFiltering(promise: Promise) {
    val active = runtime.start { decision -> emitDecision(decision) }
    promise.resolve(Arguments.createMap().apply { putBoolean("active", active) })
  }

  @ReactMethod
  fun stopFiltering() = runtime.stop()

  @ReactMethod fun addListener(eventName: String) = Unit
  @ReactMethod fun removeListeners(count: Double) = Unit

  override fun invalidate() {
    val recorder = synchronized(this) {
      enrollmentGeneration += 1
      val current = enrollmentRecorder
      enrollmentRecorder = null
      current
    }
    try {
      recorder?.stop()
    } catch (_: IllegalStateException) {
      // Capture cleanup remains idempotent when Android already stopped the recorder.
    }
    runtime.stop()
    super.invalidate()
  }

  private fun beginEnrollment(generation: Long, token: String, promise: Promise) {
    var ownedRecorder: AudioRecord? = null
    var ownedEffects: PreparedMicrophoneEffects? = null
    try {
      val minimum = AudioRecord.getMinBufferSize(
        PersonalVoiceFeatures.SAMPLE_RATE,
        AudioFormat.CHANNEL_IN_MONO,
        AudioFormat.ENCODING_PCM_16BIT,
      )
      check(minimum > 0) { "Microphone buffer is unavailable" }
      val recorder = AudioRecord(
        MediaRecorder.AudioSource.VOICE_COMMUNICATION,
        PersonalVoiceFeatures.SAMPLE_RATE,
        AudioFormat.CHANNEL_IN_MONO,
        AudioFormat.ENCODING_PCM_16BIT,
        maxOf(minimum, READ_SAMPLES * 2),
      )
      ownedRecorder = recorder
      check(recorder.state == AudioRecord.STATE_INITIALIZED) { "Microphone could not be initialized" }
      val effects = PreparedMicrophoneEffectsFactory(AndroidMicrophoneEffectsPlatform) { _, _ -> }.create(
        recorder.audioSessionId,
      )
      ownedEffects = effects
      val accepted = synchronized(this) {
        if (generation != enrollmentGeneration || enrollmentRecorder != null) false else {
          enrollmentRecorder = recorder
          true
        }
      }
      check(accepted) { "Voice profile recording was cancelled" }
      recorder.startRecording()
      thread(name = "CodeWideVoiceProfileEnrollment", isDaemon = true) {
        captureEnrollment(generation, token, recorder, effects, promise)
      }
    } catch (error: Throwable) {
      synchronized(this) {
        if (enrollmentRecorder === ownedRecorder) enrollmentRecorder = null
      }
      releaseEffects(ownedEffects)
      releaseRecorder(ownedRecorder, stopFirst = false)
      VoiceCaptureForegroundService.release(token)
      promise.reject("VOICE_PROFILE_START_FAILED", error.message, error)
    }
  }

  private fun captureEnrollment(
    generation: Long,
    token: String,
    recorder: AudioRecord,
    effects: PreparedMicrophoneEffects,
    promise: Promise,
  ) {
    val captured = ShortArray(ENROLLMENT_SAMPLES)
    var offset = 0
    var failure: Throwable? = null
    try {
      while (offset < captured.size && synchronized(this) { generation == enrollmentGeneration }) {
        val count = recorder.read(
          captured,
          offset,
          minOf(READ_SAMPLES, captured.size - offset),
          AudioRecord.READ_BLOCKING,
        )
        check(count > 0) { "Microphone stopped while recording the voice profile" }
        offset += count
      }
      check(offset == captured.size) { "Voice profile recording was cancelled" }
      val profile = PersonalVoiceFeatures.embedding(captured)
        ?: error("Speak continuously and try recording the voice profile again")
      runtime.saveProfile(profile)
    } catch (error: Throwable) {
      failure = error
    } finally {
      synchronized(this) {
        if (enrollmentRecorder === recorder) enrollmentRecorder = null
      }
      releaseEffects(effects)
      releaseRecorder(recorder, stopFirst = true)
      VoiceCaptureForegroundService.release(token)
    }
    val error = failure
    if (error == null) {
      promise.resolve(Arguments.createMap().apply { putBoolean("hasProfile", true) })
    } else {
      promise.reject("VOICE_PROFILE_CAPTURE_FAILED", error.message, error)
    }
  }

  private fun emitDecision(decision: PersonalVoiceFilterDecision) {
    context.runOnUiQueueThread {
      if (!context.hasActiveReactInstance()) return@runOnUiQueueThread
      context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit(
        DECISION_EVENT,
        Arguments.createMap().apply {
          putBoolean("open", decision.open)
          putDouble("similarity", decision.similarity)
        },
      )
    }
  }

  private fun releaseEffects(effects: PreparedMicrophoneEffects?) {
    try {
      effects?.release()
    } catch (_: RuntimeException) {
      // Capture completion remains authoritative after best-effort effect cleanup.
    }
  }

  private fun releaseRecorder(recorder: AudioRecord?, stopFirst: Boolean) {
    if (recorder == null) return
    if (stopFirst) {
      try {
        recorder.stop()
      } catch (_: IllegalStateException) {
        // Capture completion remains authoritative after best-effort recorder cleanup.
      }
    }
    try {
      recorder.release()
    } catch (_: RuntimeException) {
      // Capture completion remains authoritative after best-effort recorder cleanup.
    }
  }

  private companion object {
    const val DECISION_EVENT = "CodeWidePersonalVoiceFilterDecision"
    const val ENROLLMENT_SAMPLES = PersonalVoiceFeatures.SAMPLE_RATE * 6
    const val READ_SAMPLES = PersonalVoiceFeatures.SAMPLE_RATE / 10
  }
}
