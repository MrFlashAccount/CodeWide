package dev.codewide.app.remote

import android.content.Context

internal enum class AgentNotificationMode(val key: String) {
  SYSTEM("system"), SILENT("silent"), OFF("off"),
}

internal enum class AgentNotificationEvent(val key: String, val defaultMode: AgentNotificationMode) {
  ANSWER("answer", AgentNotificationMode.SILENT),
  INPUT("input", AgentNotificationMode.SYSTEM),
  FAILURE("failure", AgentNotificationMode.SYSTEM),
}

/** The service reads these device-wide settings even when the React runtime is stopped. */
internal class AgentNotificationPreferences(context: Context) {
  private val store = context.getSharedPreferences("agent_notifications", Context.MODE_PRIVATE)

  val enabled: Boolean get() = store.getBoolean("enabled", true)

  fun mode(event: AgentNotificationEvent): AgentNotificationMode {
    val saved = store.getString(event.key, null)
    return AgentNotificationMode.entries.find { it.key == saved } ?: event.defaultMode
  }

  fun delivery(event: AgentNotificationEvent) = if (enabled) mode(event) else AgentNotificationMode.OFF

  fun setEnabled(enabled: Boolean) {
    check(store.edit().putBoolean("enabled", enabled).commit()) { "Could not save agent notifications" }
  }

  fun setMode(event: AgentNotificationEvent, mode: AgentNotificationMode) {
    check(store.edit().putString(event.key, mode.key).commit()) { "Could not save the notification mode" }
  }
}
