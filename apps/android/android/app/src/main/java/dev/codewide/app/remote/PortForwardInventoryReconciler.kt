package dev.codewide.app.remote

/** The discovered set owns membership; user policy only selects its enabled subset. */
internal class PortForwardInventoryReconciler(
  private val store: NativePortForwardStore,
  private val preference: (String, String, Int) -> String,
  private val upsert: (String, PortForwardInventoryEntry, CurrentPortForward?, String) -> CurrentPortForward,
  private val isHealthy: (String) -> Boolean,
  private val start: (String) -> Unit,
  private val remove: (String) -> Unit,
) {
  fun reconcile(connectionId: String, inventory: List<PortForwardInventoryEntry>) {
    val discovered = inventory.associate { it.port to it.serviceKey }
    for (profile in store.list(connectionId)) {
      if (!portForwardIsCurrent(profile, discovered)) remove(profile.id)
    }
    for (entry in inventory) {
      val selected = preference(connectionId, entry.serviceKey, entry.port)
      val enabled = selected == "included" || (selected == "automatic" && entry.defaultEnabled)
      val existing = store.list(connectionId).firstOrNull { it.serviceKey == entry.serviceKey }
      if (!enabled && selected != "excluded") {
        if (existing != null) remove(existing.id)
        continue
      }
      val profile = if (existing == null || existing.remotePort != entry.port || existing.preference != selected || existing.label != entry.label) {
        upsert(connectionId, entry, existing, selected)
      } else existing
      if (enabled && !isHealthy(profile.id)) start(profile.id)
    }
  }
}
