package dev.codewide.app.remote

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

internal class AgentNotificationSettingsModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  private val preferences by lazy { AgentNotificationPreferences(context) }

  override fun getName() = "CodeWideAgentNotificationSettings"

  @ReactMethod fun read(promise: Promise) = respond(promise) {}

  @ReactMethod fun setEnabled(enabled: Boolean, promise: Promise) = respond(promise) {
    preferences.setEnabled(enabled)
  }

  @ReactMethod fun setMode(event: String, mode: String, promise: Promise) = respond(promise) {
    val kind = requireNotNull(AgentNotificationEvent.entries.find { it.key == event }) { "Unknown notification event" }
    val selection = requireNotNull(AgentNotificationMode.entries.find { it.key == mode }) { "Unknown notification mode" }
    preferences.setMode(kind, selection)
  }

  private fun respond(promise: Promise, update: () -> Unit) {
    try {
      update()
      promise.resolve(Arguments.createMap().apply {
        putBoolean("enabled", preferences.enabled)
        AgentNotificationEvent.entries.forEach { putString(it.key, preferences.mode(it).key) }
      })
    } catch (error: Exception) {
      promise.reject("agent_notification_settings", error)
    }
  }
}
