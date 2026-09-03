package dev.codewide.app.remote

import android.content.Context

/** Durable content-free notification baseline used across Android process recreation. */
internal class V2NotificationProjectionStore(context: Context) {
  private val preferences = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)

  fun read(savedServerId: String): String? = preferences.getString(key(savedServerId), null)

  fun write(savedServerId: String, state: String): Boolean =
    preferences.edit().putString(key(savedServerId), state).commit()

  fun remove(savedServerId: String): Boolean = preferences.edit().remove(key(savedServerId)).commit()

  fun savedServerIds(): Set<String> = preferences.all.keys
    .filter { it.startsWith(KEY_PREFIX) }
    .mapTo(mutableSetOf()) { it.removePrefix(KEY_PREFIX) }

  fun clear(): Boolean {
    val editor = preferences.edit()
    preferences.all.keys.filter { it.startsWith(KEY_PREFIX) }.forEach(editor::remove)
    return editor.commit()
  }

  private fun key(savedServerId: String): String = "$KEY_PREFIX$savedServerId"

  private companion object {
    const val PREFERENCES = "codewide_v2_notifications"
    const val KEY_PREFIX = "server:"
  }
}
