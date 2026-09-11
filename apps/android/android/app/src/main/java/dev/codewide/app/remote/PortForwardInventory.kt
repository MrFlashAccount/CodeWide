package dev.codewide.app.remote

import org.json.JSONArray

internal data class PortForwardInventoryEntry(
  val port: Int,
  val serviceKey: String,
  val label: String,
  val defaultEnabled: Boolean,
)

/** Validate the complete scan before it can revoke or create any listener. */
internal fun parsePortForwardInventory(rows: JSONArray): List<PortForwardInventoryEntry> {
  require(rows.length() <= 256) { "Port inventory exceeds the protocol limit" }
  val ports = mutableSetOf<Int>()
  val keys = mutableSetOf<String>()
  return buildList {
    for (index in 0 until rows.length()) {
      val row = rows.getJSONObject(index)
      val portValue = row.get("port")
      require(portValue is Number && portValue.toDouble() == portValue.toInt().toDouble()) { "Port is invalid" }
      val port = portValue.toInt()
      val key = row.get("forwardingKey")
      val name = row.get("name")
      val enabled = row.get("defaultForwardingEnabled")
      require(port in 1..65_535 && ports.add(port)) { "Port inventory contains an invalid or duplicate port" }
      require(key is String && key.matches(Regex("^[a-f0-9]{64}$")) && keys.add(key)) { "Port inventory service identity is invalid" }
      require(name is String && name.length <= 256 && enabled is Boolean) { "Port inventory metadata is invalid" }
      val label = name.filter { it.code >= 32 && it.code != 127 }.take(80).ifBlank { "Port $port" }
      add(PortForwardInventoryEntry(port, key, label, enabled))
    }
  }
}

internal fun portForwardIsCurrent(profile: CurrentPortForward, discovered: Map<Int, String>): Boolean =
  profile.serviceKey != null && discovered[profile.remotePort] == profile.serviceKey
