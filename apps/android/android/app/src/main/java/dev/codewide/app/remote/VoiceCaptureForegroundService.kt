package dev.codewide.app.remote

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.content.res.Configuration
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import dev.codewide.app.MainActivity
import dev.codewide.app.R
import dev.codewide.app.rendering.VoiceAssistantOrbState
import dev.codewide.app.rendering.VoiceAssistantOrbStyle
import java.util.concurrent.ConcurrentHashMap

/** Keeps Android's microphone foreground grant alive while any voice owner holds a token. */
class VoiceCaptureForegroundService : Service() {
  private val lifetime = VoiceForegroundLifetime()
  private lateinit var globalVoiceOverlay: GlobalVoiceOverlayController

  override fun onCreate() {
    super.onCreate()
    globalVoiceOverlay = GlobalVoiceOverlayController(
      this,
      GlobalVoiceForegroundModule::requestStopFromOverlay,
      orbStyle,
      orbState,
      orbReducedMotion,
      orbLaunchOrigin,
    )
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
    globalVoiceOverlay.hideImmediately()
    lifetime.clear()
    failPending(IllegalStateException("Voice capture foreground service stopped"))
    super.onDestroy()
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    globalVoiceOverlay.onConfigurationChanged()
  }

  override fun onBind(intent: Intent?): IBinder? = null

  private fun release(token: String, completion: () -> Unit) {
    val finalRelease = lifetime.release(token)
    if (lifetime.hasOverlay()) {
      globalVoiceOverlay.show()
      completion()
      if (finalRelease) stopIfIdle()
      return
    }
    globalVoiceOverlay.hide(GlobalVoiceForegroundModule.visibleOrbReturnTarget()) {
      completion()
      if (finalRelease) stopIfIdle()
    }
  }

  private fun syncOverlay() {
    if (lifetime.hasOverlay()) globalVoiceOverlay.show()
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
    private const val NOTIFICATION_ID = 42_012
    private val pending = ConcurrentHashMap<String, (Throwable?) -> Unit>()
    @Volatile private var instance: VoiceCaptureForegroundService? = null
    @Volatile private var orbStyle = VoiceAssistantOrbStyle.NEBULA
    @Volatile private var orbState = VoiceAssistantOrbState.IDLE
    @Volatile private var orbReducedMotion = false
    @Volatile private var orbLaunchOrigin: VoiceOverlayLaunchOrigin? = null
    fun updateOrbLevel(level: Double) {
      val active = instance ?: return
      active.mainExecutor.execute {
        if (instance === active && active.lifetime.hasOverlay()) {
          active.globalVoiceOverlay.updateLevel(level.coerceIn(0.0, 1.0))
        }
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
      active.mainExecutor.execute { active.globalVoiceOverlay.updateOrbState(state) }
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
