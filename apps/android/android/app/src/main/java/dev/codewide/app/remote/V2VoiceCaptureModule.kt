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
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.concurrent.thread

/** Captures bounded PCM only; the generated Voice protocol and network lifecycle remain outside Android native code. */
class V2VoiceCaptureModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  @Volatile private var active = false
  private var generation = 0L
  private var recorder: V2VoiceRecorderLease? = null

  override fun getName(): String = "CodeWideV2VoiceCapture"

  @ReactMethod
  fun start(captureId: String, promise: Promise) {
    if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
      promise.reject("MIC_PERMISSION", "Microphone permission is required")
      return
    }
    var lease: V2VoiceRecorderLease? = null
    try {
      require(captureId.isNotBlank() && captureId.length <= 256) { "Voice capture id is invalid" }
      stopInternal()
      val minimum = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
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
      val current = synchronized(this) {
        generation += 1
        active = true
        recorder = createdLease
        generation
      }
      created.startRecording()
      thread(name = "CodeWideV2VoiceCapture", isDaemon = true) { capture(captureId, current, created, createdLease) }
      promise.resolve(Arguments.createMap().apply {
        putInt("sampleRate", SAMPLE_RATE)
        putInt("numChannels", 1)
      })
    } catch (error: Throwable) {
      stopInternal()
      lease?.release()
      promise.reject("V2_VOICE_CAPTURE_FAILED", error.message, error)
    }
  }

  @ReactMethod fun stop() = stopInternal()
  @ReactMethod fun addListener(eventName: String) = Unit
  @ReactMethod fun removeListeners(count: Double) = Unit

  override fun invalidate() {
    stopInternal()
    super.invalidate()
  }

  private fun capture(captureId: String, current: Long, source: AudioRecord, lease: V2VoiceRecorderLease) {
    val samples = ShortArray(SAMPLES_PER_CHUNK)
    try {
      while (active && generation == current) {
        val count = source.read(samples, 0, samples.size, AudioRecord.READ_BLOCKING)
        if (count <= 0) break
        val bytes = ByteBuffer.allocate(count * 2).order(ByteOrder.LITTLE_ENDIAN)
        for (index in 0 until count) bytes.putShort(samples[index])
        emit(Arguments.createMap().apply {
          putString("captureId", captureId)
          putString("type", "batch")
          putInt("sampleRate", SAMPLE_RATE)
          putInt("numChannels", 1)
          putInt("samplesPerChannel", count)
          putString("data", Base64.encodeToString(bytes.array(), Base64.NO_WRAP))
        })
      }
    } finally {
      synchronized(this) {
        if (generation == current) {
          active = false
          recorder = null
        }
      }
      lease.release()
      emit(Arguments.createMap().apply {
        putString("captureId", captureId)
        putString("type", "stopped")
      })
    }
  }

  private fun stopInternal() {
    val current = synchronized(this) {
      active = false
      generation += 1
      val value = recorder
      recorder = null
      value
    }
    current?.stop()
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
