package dev.codewide.app.remote

import org.json.JSONArray

internal data class PortForwardInventoryEntry(
  val port: Int,
  val serviceKey: String,
  val label: String,
  val defaultEnabled: Boolean,
)

/**
 * Validate the complete scan before it can revoke or create any listener.
 *
 * A malformed row rejects the scan: the server violated the protocol. Rows that
 * are well formed but ambiguous, because another row has the same port or the
 * same service identity, are dropped together, so one ambiguous service never
 * hides every other port.
 */
internal fun parsePortForwardInventory(rows: JSONArray): List<PortForwardInventoryEntry> {
  require(rows.length() <= 256) { "Port inventory exceeds the protocol limit" }
  val entries = buildList {
    for (index in 0 until rows.length()) {
      val row = rows.getJSONObject(index)
      val portValue = row.get("port")
      require(portValue is Number && portValue.toDouble() == portValue.toInt().toDouble()) { "Port is invalid" }
      val port = portValue.toInt()
      val key = row.get("forwardingKey")
      val name = row.get("name")
      val enabled = row.get("defaultForwardingEnabled")
      require(port in 1..65_535) { "Port inventory contains an invalid port" }
      require(key is String && key.matches(Regex("^[a-f0-9]{64}$"))) { "Port inventory service identity is invalid" }
      require(name is String && name.length <= 256 && enabled is Boolean) { "Port inventory metadata is invalid" }
      val label = name.filter { it.code >= 32 && it.code != 127 }.take(80).ifBlank { "Port $port" }
      add(PortForwardInventoryEntry(port, key, label, enabled))
    }
  }
  val portCounts = entries.groupingBy { it.port }.eachCount()
  val keyCounts = entries.groupingBy { it.serviceKey }.eachCount()
  return entries.filter { portCounts.getValue(it.port) == 1 && keyCounts.getValue(it.serviceKey) == 1 }
}

internal fun portForwardIsCurrent(profile: CurrentPortForward, discovered: Map<Int, String>): Boolean =
  profile.serviceKey != null && discovered[profile.remotePort] == profile.serviceKey
