package dev.codewide.app.remote

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import dev.codewide.app.MainActivity
import dev.codewide.app.R

/** Android alerts for agent activity. Foreground service status uses its own channel and lifecycle. */
internal class AgentNotifications(private val context: Context) {
  private val preferences = AgentNotificationPreferences(context)
  private val manager = context.getSystemService(NotificationManager::class.java)

  fun createChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    manager.createNotificationChannel(
      NotificationChannel(CHANNEL_ID, "Codex turn updates", NotificationManager.IMPORTANCE_DEFAULT).apply {
        description = "Agent responses, failures and requests for input"
        setShowBadge(true)
        lockscreenVisibility = Notification.VISIBILITY_PRIVATE
      },
    )
  }

  fun turnFinished(connectionId: String, threadId: String, failed: Boolean) {
    val event = if (failed) AgentNotificationEvent.FAILURE else AgentNotificationEvent.ANSWER
    val mode = preferences.delivery(event)
    if (mode == AgentNotificationMode.OFF) return
    val notification = builder(mode, "A remote turn finished")
      .setContentTitle(if (failed) "Agent turn failed" else "Agent turn completed")
      .setContentText("Tap to open the thread")
      .setContentIntent(openThread(connectionId, threadId, ("$connectionId\u0000$threadId").hashCode()))
      .build()
    manager.notify(("turn:$connectionId\u0000$threadId").hashCode(), notification)
  }

  fun needsInput(connectionId: String, threadId: String?, requestId: String) {
    val mode = preferences.delivery(AgentNotificationEvent.INPUT)
    if (mode == AgentNotificationMode.OFF) return
    val id = inputId(connectionId, requestId)
    val notification = builder(mode, "A remote session needs attention")
      .setContentTitle("Agent needs your input")
      .setContentText("Open the thread to review the request")
      .setContentIntent(openThread(connectionId, threadId, id))
      .setOnlyAlertOnce(true)
      .build()
    manager.notify(id, notification)
  }

  fun cancelInput(connectionId: String, requestId: String) = manager.cancel(inputId(connectionId, requestId))

  private fun inputId(connectionId: String, requestId: String) = ("approval:$connectionId\u0000$requestId").hashCode()

  private fun builder(mode: AgentNotificationMode, publicText: String): NotificationCompat.Builder {
    val publicVersion = NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(R.drawable.ic_stat_codewide)
      .setContentTitle("CodeWide")
      .setContentText(publicText)
      .build()
    return NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(R.drawable.ic_stat_codewide)
      .setColor(Color.WHITE)
      .setAutoCancel(true)
      .setCategory(NotificationCompat.CATEGORY_MESSAGE)
      .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
      .setPublicVersion(publicVersion)
      .setSilent(mode == AgentNotificationMode.SILENT)
  }

  private fun openThread(connectionId: String, threadId: String?, requestCode: Int): PendingIntent {
    val intent = if (threadId.isNullOrBlank()) Intent(context, MainActivity::class.java) else {
      val uri = Uri.Builder().scheme("codewide").authority("thread")
        .appendQueryParameter("savedServerId", connectionId)
        .appendQueryParameter("connectionId", connectionId)
        .appendQueryParameter("threadId", threadId)
        .build()
      Intent(Intent.ACTION_VIEW, uri, context, MainActivity::class.java)
    }
    return PendingIntent.getActivity(
      context, requestCode, intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  private companion object {
    const val CHANNEL_ID = "codewide_turn_updates"
  }
}
