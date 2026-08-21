package dev.codewide.app.remote

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

internal data class StoredPortForward(
  val id: String,
  val connectionId: String,
  val label: String,
  val remotePort: Int,
  val preferredLocalPort: Int?,
  val serviceKey: String?,
  val preference: String,
  val enabled: Boolean,
  val updatedAt: Long,
)

/** Durable configuration only; live sockets and status remain service-owned. */
internal class NativePortForwardStore(context: Context) {
  private val preferences = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)

  fun list(connectionId: String? = null): List<StoredPortForward> = synchronized(STORE_LOCK) {
    readUnlocked().filter { connectionId == null || it.connectionId == connectionId }
  }

  fun get(id: String): StoredPortForward? = synchronized(STORE_LOCK) {
    readUnlocked().firstOrNull { it.id == id }
  }

  fun upsert(profile: StoredPortForward): StoredPortForward = synchronized(STORE_LOCK) {
    validate(profile)
    val profiles = readUnlocked().associateByTo(linkedMapOf()) { it.id }
    if (!profiles.containsKey(profile.id)) require(profiles.size < MAX_PROFILES) { "Too many saved port forwards" }
    profiles[profile.id] = profile
    writeUnlocked(profiles.values.toList())
    profile
  }

  fun setEnabled(id: String, enabled: Boolean): StoredPortForward? = synchronized(STORE_LOCK) {
    val profiles = readUnlocked().associateByTo(linkedMapOf()) { it.id }
    val current = profiles[id] ?: return@synchronized null
    val updated = current.copy(enabled = enabled, updatedAt = System.currentTimeMillis())
    profiles[id] = updated
    writeUnlocked(profiles.values.toList())
    updated
  }

  fun remove(id: String): Boolean = synchronized(STORE_LOCK) {
    val profiles = readUnlocked()
    val filtered = profiles.filterNot { it.id == id }
    if (filtered.size == profiles.size) return@synchronized false
    writeUnlocked(filtered)
    true
  }

  fun removeConnection(connectionId: String) = synchronized(STORE_LOCK) {
    writeUnlocked(readUnlocked().filterNot { it.connectionId == connectionId })
  }

  private fun readUnlocked(): List<StoredPortForward> {
    val raw = preferences.getString(PROFILES_KEY, null) ?: return emptyList()
    return runCatching {
      val envelope = JSONObject(raw)
      require(envelope.getInt("version") == FORMAT_VERSION)
      val array = envelope.getJSONArray("profiles")
      buildList {
        for (index in 0 until array.length()) {
          val value = array.getJSONObject(index)
          val profile = StoredPortForward(
            id = value.getString("id"),
            connectionId = value.getString("connectionId"),
            label = value.getString("label"),
            remotePort = value.getInt("remotePort"),
            preferredLocalPort = if (value.isNull("preferredLocalPort")) null else value.getInt("preferredLocalPort"),
            serviceKey = if (!value.has("serviceKey") || value.isNull("serviceKey")) null else value.getString("serviceKey"),
            // Profiles created before service discovery were explicit manual
            // includes. Preserve that contract during the additive migration.
            preference = value.optString("preference", "included"),
            enabled = value.optBoolean("enabled", false),
            updatedAt = value.getLong("updatedAt"),
          )
          validate(profile)
          add(profile)
        }
      }
    }.getOrElse {
      preferences.edit().remove(PROFILES_KEY).commit()
      emptyList()
    }
  }

  private fun writeUnlocked(profiles: List<StoredPortForward>) {
    if (profiles.isEmpty()) {
      check(preferences.edit().remove(PROFILES_KEY).commit()) { "Could not clear port forwards" }
      return
    }
    val values = JSONArray()
    profiles.forEach { profile ->
      values.put(JSONObject().apply {
        put("id", profile.id)
        put("connectionId", profile.connectionId)
        put("label", profile.label)
        put("remotePort", profile.remotePort)
        put("preferredLocalPort", profile.preferredLocalPort ?: JSONObject.NULL)
        put("serviceKey", profile.serviceKey ?: JSONObject.NULL)
        put("preference", profile.preference)
        put("enabled", profile.enabled)
        put("updatedAt", profile.updatedAt)
      })
    }
    val envelope = JSONObject().put("version", FORMAT_VERSION).put("profiles", values)
    check(preferences.edit().putString(PROFILES_KEY, envelope.toString()).commit()) {
      "Could not persist port forwards"
    }
  }

  companion object {
    private val STORE_LOCK = Any()
    private const val PREFERENCES = "codewide_native_port_forwards"
    private const val PROFILES_KEY = "profiles"
    private const val FORMAT_VERSION = 1
    private const val MAX_PROFILES = 64

    fun validate(profile: StoredPortForward) {
      require(profile.id.matches(Regex("^[A-Za-z0-9._:-]{1,128}$"))) { "Port forward id is invalid" }
      require(profile.connectionId.isNotBlank() && profile.connectionId.length <= 160) { "Connection id is invalid" }
      require(profile.label.isNotBlank() && profile.label.length <= 80 && !profile.label.any { it.code < 32 || it.code == 127 }) { "Label is invalid" }
      require(profile.remotePort in 1..65_535) { "Remote port is invalid" }
      require(profile.preferredLocalPort == null || profile.preferredLocalPort in 1..65_535) { "Local port is invalid" }
      require(profile.serviceKey == null || profile.serviceKey.matches(Regex("^[a-f0-9]{64}$"))) { "Service key is invalid" }
      require(profile.preference in setOf("automatic", "included", "excluded")) { "Forwarding preference is invalid" }
    }
  }
}
