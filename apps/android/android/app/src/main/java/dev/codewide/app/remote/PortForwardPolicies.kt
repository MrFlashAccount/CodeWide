package dev.codewide.app.remote

import org.json.JSONArray
import org.json.JSONObject

/** Persistent user decisions, never an inventory of ports or running forwards. */
internal class PortForwardPolicies(raw: String? = null, legacy: String? = null) {
  private data class Key(val connectionId: String, val serviceKey: String)
  private val values = linkedMapOf<Key, String>()

  init {
    if (raw != null) {
      val rows = JSONObject(raw).getJSONArray("policies")
      for (index in 0 until rows.length()) {
        val row = rows.getJSONObject(index)
        set(row.getString("connectionId"), row.getString("serviceKey"), row.getString("preference"))
      }
    } else if (legacy != null) {
      val rows = JSONObject(legacy).getJSONArray("profiles")
      for (index in 0 until rows.length()) {
        val row = rows.getJSONObject(index)
        val preference = row.optString("preference", "included")
        val key = if (!row.isNull("serviceKey")) row.getString("serviceKey") else null
        // An old manual include has no service identity and must not authorize
        // an unrelated process that later reuses that port. Exclusions are safe.
        if (key != null) set(row.getString("connectionId"), key, preference)
        else if (preference == "excluded") {
          set(row.getString("connectionId"), "port:${row.getInt("remotePort")}", preference)
        }
      }
    }
  }

  fun preference(connectionId: String, serviceKey: String, port: Int): String =
    values[Key(connectionId, serviceKey)] ?: values[Key(connectionId, "port:$port")] ?: "automatic"

  fun set(connectionId: String, serviceKey: String, preference: String) {
    require(connectionId.isNotBlank() && connectionId.length <= 160)
    require(serviceKey.matches(Regex("^[a-f0-9]{64}$|^port:[0-9]{1,5}$")))
    require(preference in setOf("automatic", "included", "excluded"))
    val key = Key(connectionId, serviceKey)
    if (preference == "automatic") values.remove(key) else values[key] = preference
  }

  fun removeConnection(connectionId: String) {
    values.keys.removeAll { it.connectionId == connectionId }
  }

  fun serialize(): String {
    val rows = JSONArray()
    values.forEach { (key, preference) ->
      rows.put(JSONObject().put("connectionId", key.connectionId)
        .put("serviceKey", key.serviceKey).put("preference", preference))
    }
    return JSONObject().put("version", 2).put("policies", rows).toString()
  }
}
