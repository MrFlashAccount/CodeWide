package dev.codewide.app.remote

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import dev.codewide.app.MainActivity
import dev.codewide.app.R
import java.util.concurrent.ConcurrentHashMap

/** Keeps Android's microphone grant alive only while a V2 PCM capture owns a lease. */
class V2VoiceCaptureForegroundService : Service() {
  private val lifetime = V2VoiceForegroundLifetime()

  override fun onCreate() {
    super.onCreate()
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
      lifetime.acquire(token)
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
    } catch (error: Throwable) {
      lifetime.release(token)
      complete(token, error)
      stopIfIdle()
    }
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    if (instance === this) instance = null
    lifetime.clear()
    failPending(IllegalStateException("Voice capture foreground service stopped"))
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null

  private fun release(token: String) {
    if (lifetime.release(token)) stopIfIdle()
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
    private const val CHANNEL_ID = "codewide_voice_capture"
    private const val NOTIFICATION_ID = 42_012
    private val pending = ConcurrentHashMap<String, (Throwable?) -> Unit>()
    @Volatile private var instance: V2VoiceCaptureForegroundService? = null

    fun acquire(context: Context, token: String, completion: (Throwable?) -> Unit) {
      check(pending.putIfAbsent(token, completion) == null) { "Voice capture token is already pending" }
      try {
        ContextCompat.startForegroundService(
          context,
          Intent(context, V2VoiceCaptureForegroundService::class.java)
            .setAction(ACTION_ACQUIRE)
            .putExtra(EXTRA_TOKEN, token),
        )
      } catch (error: Throwable) {
        complete(token, error)
      }
    }

    fun release(token: String) {
      pending.remove(token)?.invoke(IllegalStateException("Voice capture start was cancelled"))
      val active = instance ?: return
      active.mainExecutor.execute { active.release(token) }
    }

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
internal class V2VoiceForegroundLifetime {
  private val tokens = mutableSetOf<String>()

  fun acquire(token: String) {
    check(tokens.add(token)) { "Voice capture token is already active" }
  }

  /** Returns true only when this release removed the final active token. */
  fun release(token: String): Boolean = tokens.remove(token) && tokens.isEmpty()

  fun isEmpty(): Boolean = tokens.isEmpty()

  fun clear() = tokens.clear()
}
