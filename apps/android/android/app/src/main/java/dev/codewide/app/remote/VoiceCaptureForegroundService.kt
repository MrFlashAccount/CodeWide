package dev.codewide.app.remote

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.content.res.Configuration
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import dev.codewide.app.MainActivity
import dev.codewide.app.R
import dev.codewide.app.rendering.VoiceAssistantOrbState
import dev.codewide.app.rendering.VoiceAssistantOrbStyle
import java.util.concurrent.ConcurrentHashMap

internal enum class GlobalVoiceAudioRecordFailureKind(val diagnosticValue: String) {
  INIT("init"),
  RUNTIME("runtime"),
  START("start"),
}

/** Keeps Android's microphone foreground grant alive while any voice owner holds a token. */
class VoiceCaptureForegroundService : Service() {
  private val lifetime = VoiceForegroundLifetime()
  private lateinit var audioLevels: GlobalVoiceAudioLevelOwner
  private lateinit var captureHealth: GlobalVoiceCaptureHealthOwner
  private lateinit var globalVoiceOverlay: GlobalVoiceOverlayController
  private val healthHandler = Handler(Looper.getMainLooper())
  private var healthCheckScheduled = false
  private var screenReceiverRegistered = false
  private val healthCheck = object : Runnable {
    override fun run() {
      healthCheckScheduled = false
      captureHealth.check()
      scheduleHealthCheckIfNeeded()
    }
  }
  private val screenStateReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) {
      val interactive = intent?.action == Intent.ACTION_SCREEN_ON
      val snapshot = captureHealth.setScreenInteractive(interactive)
      Log.i(
        LOG_TAG,
        "screenInteractive=$interactive active=${snapshot.active} " +
          "expectedCapture=${snapshot.expectedCapture} microphoneMuted=${snapshot.microphoneMuted} " +
          "audioRecordRunning=${snapshot.audioRecordRunning} sampleAgeMs=${snapshot.sampleAgeMs}",
      )
      captureHealth.check()
      scheduleHealthCheckIfNeeded()
    }
  }

  override fun onCreate() {
    super.onCreate()
    globalVoiceOverlay = GlobalVoiceOverlayController(
      this,
      GlobalVoiceForegroundModule::requestMicrophoneToggleFromOverlay,
      GlobalVoiceForegroundModule::requestStopFromOverlay,
      microphoneMuted,
      orbStyle,
      orbState,
      orbReducedMotion,
      orbLaunchOrigin,
    )
    audioLevels = GlobalVoiceAudioLevelOwner(
      executeOnMain = { action -> mainExecutor.execute(action) },
      publish = globalVoiceOverlay::updateAudioLevels,
    )
    captureHealth = GlobalVoiceCaptureHealthOwner(
      nowMs = SystemClock::elapsedRealtime,
      onEvent = { event -> mainExecutor.execute { acceptCaptureHealthEvent(event) } },
    )
    audioLevels.setMicrophoneMuted(microphoneMuted)
    captureHealth.setMicrophoneMuted(microphoneMuted)
    captureHealth.setExpectedCapture(orbState.expectsMicrophoneCapture())
    val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
    captureHealth.setScreenInteractive(powerManager.isInteractive)
    ContextCompat.registerReceiver(
      this,
      screenStateReceiver,
      IntentFilter().apply {
        addAction(Intent.ACTION_SCREEN_OFF)
        addAction(Intent.ACTION_SCREEN_ON)
      },
      ContextCompat.RECEIVER_NOT_EXPORTED,
    )
    screenReceiverRegistered = true
    instance = this
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    manager.createNotificationChannel(
      NotificationChannel(
        CHANNEL_ID,
        getString(R.string.voice_capture_notification_channel),
        NotificationManager.IMPORTANCE_LOW,
      ),
    )
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val token = intent?.getStringExtra(EXTRA_TOKEN)
    if (intent?.action != ACTION_ACQUIRE || token.isNullOrBlank() || !pending.containsKey(token)) {
      if (lifetime.isEmpty()) stopSelf(startId)
      return START_NOT_STICKY
    }
    try {
      lifetime.acquire(token, intent.getBooleanExtra(EXTRA_GLOBAL_VOICE_OVERLAY, false))
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        startForeground(
          NOTIFICATION_ID,
          notification(),
          ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE,
        )
      } else {
        startForeground(NOTIFICATION_ID, notification())
      }
      complete(token, null)
      syncOverlay()
    } catch (error: Throwable) {
      lifetime.release(token)
      complete(token, error)
      stopIfIdle()
    }
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    if (instance === this) instance = null
    healthHandler.removeCallbacks(healthCheck)
    healthCheckScheduled = false
    captureHealth.setActive(false)
    audioLevels.setActive(false)
    globalVoiceOverlay.hideImmediately()
    lifetime.clear()
    failPending(IllegalStateException("Voice capture foreground service stopped"))
    if (screenReceiverRegistered) {
      unregisterReceiver(screenStateReceiver)
      screenReceiverRegistered = false
    }
    super.onDestroy()
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    globalVoiceOverlay.onConfigurationChanged()
  }

  override fun onBind(intent: Intent?): IBinder? = null

  private fun release(token: String, completion: () -> Unit) {
    val finalRelease = lifetime.release(token)
    val hasOverlay = lifetime.hasOverlay()
    audioLevels.setActive(hasOverlay)
    captureHealth.setActive(hasOverlay)
    if (hasOverlay) {
      globalVoiceOverlay.show()
      scheduleHealthCheckIfNeeded()
      completion()
      if (finalRelease) stopIfIdle()
      return
    }
    healthHandler.removeCallbacks(healthCheck)
    healthCheckScheduled = false
    globalVoiceOverlay.hide(GlobalVoiceForegroundModule.visibleOrbReturnTarget()) {
      completion()
      if (finalRelease) stopIfIdle()
    }
  }

  private fun syncOverlay() {
    val hasOverlay = lifetime.hasOverlay()
    audioLevels.setActive(hasOverlay)
    captureHealth.setActive(hasOverlay)
    if (hasOverlay) {
      globalVoiceOverlay.show()
      scheduleHealthCheckIfNeeded()
    }
  }

  private fun acceptCaptureHealthEvent(event: GlobalVoiceCaptureHealthEvent) {
    if (!lifetime.hasOverlay()) return
    Log.i(
      LOG_TAG,
      "captureHealth=${event.kind.name.lowercase()} screenInteractive=${event.screenInteractive} " +
        "audioRecordRunning=${event.audioRecordRunning} sampleAgeMs=${event.sampleAgeMs}",
    )
    if (event.kind == GlobalVoiceCaptureHealthEventKind.INTERRUPTED) {
      globalVoiceOverlay.updateOrbState(VoiceAssistantOrbState.CONNECTING)
      GlobalVoiceForegroundModule.requestCaptureRecovery()
      return
    }
    globalVoiceOverlay.updateOrbState(orbState)
  }

  private fun scheduleHealthCheckIfNeeded() {
    if (!lifetime.hasOverlay() || healthCheckScheduled) return
    healthCheckScheduled = true
    healthHandler.postDelayed(healthCheck, HEALTH_CHECK_INTERVAL_MS)
  }

  private fun stopIfIdle() {
    if (!lifetime.isEmpty()) return
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  private fun notification(): Notification {
    val openApp = PendingIntent.getActivity(
      this,
      0,
      Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(R.drawable.ic_stat_codewide)
      .setContentTitle(getString(R.string.voice_capture_notification_title))
      .setContentText(getString(R.string.voice_capture_notification_text))
      .setContentIntent(openApp)
      .setOngoing(true)
      .setSilent(true)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .build()
  }

  companion object {
    private const val ACTION_ACQUIRE = "dev.codewide.app.voice.ACQUIRE"
    private const val EXTRA_TOKEN = "voice_capture_token"
    private const val EXTRA_GLOBAL_VOICE_OVERLAY = "global_voice_overlay"
    private const val CHANNEL_ID = "codewide_voice_capture"
    private const val HEALTH_CHECK_INTERVAL_MS = 1_000L
    private const val LOG_TAG = "CodeWideGlobalVoice"
    private const val NOTIFICATION_ID = 42_012
    private val pending = ConcurrentHashMap<String, (Throwable?) -> Unit>()
    @Volatile private var instance: VoiceCaptureForegroundService? = null
    @Volatile private var orbStyle = VoiceAssistantOrbStyle.NEBULA
    @Volatile private var orbState = VoiceAssistantOrbState.IDLE
    @Volatile private var orbReducedMotion = false
    @Volatile private var orbLaunchOrigin: VoiceOverlayLaunchOrigin? = null
    @Volatile private var microphoneMuted = false
    fun updatePlaybackLevel(level: Double) {
      val active = instance ?: return
      active.audioLevels.acceptPlaybackLevel(level)
    }

    fun acceptWebRtcInputSamples(audioFormat: Int, channelCount: Int, data: ByteArray) {
      val active = instance ?: return
      active.captureHealth.acceptSamples()
      active.audioLevels.acceptInputPcm(audioFormat, channelCount, data)
    }

    fun updateWebRtcAudioRecordRunning(running: Boolean) {
      val active = instance ?: return
      active.captureHealth.setAudioRecordRunning(running)
      Log.i(LOG_TAG, "audioRecordRunning=$running")
    }

    internal fun reportWebRtcAudioRecordFailure(kind: GlobalVoiceAudioRecordFailureKind) {
      val active = instance ?: return
      active.captureHealth.setAudioRecordRunning(false)
      Log.w(LOG_TAG, "audioRecordFailure=${kind.diagnosticValue}")
    }

    fun updateMicrophoneMuted(muted: Boolean) {
      microphoneMuted = muted
      val active = instance ?: return
      active.mainExecutor.execute {
        active.captureHealth.setMicrophoneMuted(muted)
        active.audioLevels.setMicrophoneMuted(muted)
        active.globalVoiceOverlay.updateMicrophoneMuted(muted)
      }
    }

    fun acquire(
      context: Context,
      token: String,
      overlay: Boolean = false,
      completion: (Throwable?) -> Unit,
    ) {
      check(pending.putIfAbsent(token, completion) == null) { "Voice capture token is already pending" }
      try {
        ContextCompat.startForegroundService(
          context,
          Intent(context, VoiceCaptureForegroundService::class.java)
            .setAction(ACTION_ACQUIRE)
            .putExtra(EXTRA_TOKEN, token)
            .putExtra(EXTRA_GLOBAL_VOICE_OVERLAY, overlay),
        )
      } catch (error: Throwable) {
        complete(token, error)
      }
    }

    fun release(token: String, completion: () -> Unit = {}) {
      val pendingCompletion = pending.remove(token)
      if (pendingCompletion !== null) {
        pendingCompletion(IllegalStateException("Voice capture start was cancelled"))
        completion()
        return
      }
      val active = instance
      if (active === null) {
        completion()
        return
      }
      active.mainExecutor.execute { active.release(token, completion) }
    }

    fun updateOrbStyle(style: VoiceAssistantOrbStyle) {
      orbStyle = style
      val active = instance ?: return
      active.mainExecutor.execute { active.globalVoiceOverlay.updateOrbStyle(style) }
    }

    fun updateOrbState(state: VoiceAssistantOrbState) {
      orbState = state
      val active = instance ?: return
      active.mainExecutor.execute {
        active.captureHealth.setExpectedCapture(state.expectsMicrophoneCapture())
        active.globalVoiceOverlay.updateOrbState(state)
      }
    }

    fun updateOrbReducedMotion(reducedMotion: Boolean) {
      orbReducedMotion = reducedMotion
      val active = instance ?: return
      active.mainExecutor.execute { active.globalVoiceOverlay.updateReducedMotion(reducedMotion) }
    }

    internal fun updateOrbLaunchOrigin(origin: VoiceOverlayLaunchOrigin) {
      orbLaunchOrigin = origin
      val active = instance ?: return
      active.mainExecutor.execute { active.globalVoiceOverlay.updateLaunchOrigin(origin) }
    }

    internal fun clearOrbLaunchOrigin() {
      orbLaunchOrigin = null
      val active = instance ?: return
      active.mainExecutor.execute { active.globalVoiceOverlay.clearLaunchOrigin() }
    }

    internal fun currentOrbLaunchOrigin(): VoiceOverlayLaunchOrigin? = orbLaunchOrigin

    private fun complete(token: String, error: Throwable?) {
      pending.remove(token)?.invoke(error)
    }

    private fun failPending(error: Throwable) {
      val callbacks = pending.entries.toList()
      for ((token, completion) in callbacks) {
        if (pending.remove(token, completion)) completion(error)
      }
    }
  }
}

private fun VoiceAssistantOrbState.expectsMicrophoneCapture(): Boolean =
  this == VoiceAssistantOrbState.LISTENING ||
    this == VoiceAssistantOrbState.THINKING ||
    this == VoiceAssistantOrbState.SPEAKING

/** Token ownership keeps a stale release from stopping a newer capture. */
internal class VoiceForegroundLifetime {
  private val tokens = mutableMapOf<String, Boolean>()

  fun acquire(token: String, overlay: Boolean = false) {
    check(tokens.putIfAbsent(token, overlay) == null) { "Voice capture token is already active" }
  }

  /** Returns true only when this release removed the final active token. */
  fun release(token: String): Boolean = tokens.remove(token) != null && tokens.isEmpty()

  fun isEmpty(): Boolean = tokens.isEmpty()

  fun hasOverlay(): Boolean = tokens.values.any { it }

  fun ownsOverlay(token: String): Boolean = tokens[token] == true

  fun clear() = tokens.clear()
}
