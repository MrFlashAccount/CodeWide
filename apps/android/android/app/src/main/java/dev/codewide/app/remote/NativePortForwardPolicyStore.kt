package dev.codewide.app.remote

import android.content.Context

/** Stores only explicit inclusion/exclusion decisions, partitioned by server. */
internal class NativePortForwardPolicyStore(context: Context) {
  private val preferences = context.getSharedPreferences("codewide_native_port_forwards", Context.MODE_PRIVATE)
  private val policies = PortForwardPolicies(preferences.getString("policies.v2", null), preferences.getString("profiles", null))

  init {
    // Publish migrated decisions atomically before removing obsolete profiles.
    persist()
  }

  @Synchronized
  fun preference(connectionId: String, serviceKey: String, port: Int): String =
    policies.preference(connectionId, serviceKey, port)

  @Synchronized
  fun set(connectionId: String, serviceKey: String, port: Int, preference: String) {
    policies.set(connectionId, "port:$port", "automatic")
    policies.set(connectionId, serviceKey, preference)
    persist()
  }

  @Synchronized
  fun removeConnection(connectionId: String) {
    policies.removeConnection(connectionId)
    persist()
  }

  private fun persist() {
    check(preferences.edit().putString("policies.v2", policies.serialize()).remove("profiles").commit()) {
      "Could not persist port forwarding preferences"
    }
  }
}
