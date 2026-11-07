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
  /**
   * Applies one inventory. Each entry settles on its own: a port that cannot be
   * forwarded never keeps the rest of the inventory from applying. Discovered
   * ports beyond the profile capacity get no automatic profile and stay
   * available to enable by hand. Returns the entries that failed.
   */
  fun reconcile(connectionId: String, inventory: List<PortForwardInventoryEntry>): List<Throwable> {
    val discovered = inventory.associate { it.port to it.serviceKey }
    for (profile in store.list(connectionId)) {
      if (!portForwardIsCurrent(profile, discovered)) remove(profile.id)
    }
    return inventory.mapNotNull { entry -> runCatching { reconcileEntry(connectionId, entry) }.exceptionOrNull() }
  }

  private fun reconcileEntry(connectionId: String, entry: PortForwardInventoryEntry) {
    val selected = preference(connectionId, entry.serviceKey, entry.port)
    val enabled = selected == "included" || (selected == "automatic" && entry.defaultEnabled)
    val existing = store.list(connectionId).firstOrNull { it.serviceKey == entry.serviceKey }
    if (!enabled && selected != "excluded") {
      if (existing != null) remove(existing.id)
      return
    }
    if (existing == null && !store.hasCapacity()) return
    val profile = if (existing == null || existing.remotePort != entry.port || existing.preference != selected || existing.label != entry.label) {
      upsert(connectionId, entry, existing, selected)
    } else existing
    if (enabled && !isHealthy(profile.id)) start(profile.id)
  }
}
