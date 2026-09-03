package dev.codewide.app.remote

internal data class V2ForegroundSyncChannel(
  val handle: String,
  val channelId: String,
)

/** Enforces one foreground V2 sync owner per saved server during runtime handoff. */
internal class V2ForegroundSyncChannels {
  private val channels = mutableMapOf<String, V2ForegroundSyncChannel>()

  @Synchronized
  fun replace(savedServerId: String, channel: V2ForegroundSyncChannel): V2ForegroundSyncChannel? =
    channels.put(savedServerId, channel)

  @Synchronized
  fun remove(channel: V2ForegroundSyncChannel): String? {
    val entry = channels.entries.firstOrNull { it.value == channel } ?: return null
    channels.remove(entry.key)
    return entry.key
  }

  @Synchronized
  fun removeServer(savedServerId: String): V2ForegroundSyncChannel? = channels.remove(savedServerId)

  @Synchronized
  fun removeHandle(handle: String): Set<String> {
    val servers = channels.filterValues { it.handle == handle }.keys.toSet()
    servers.forEach(channels::remove)
    return servers
  }

  @Synchronized fun hasServer(savedServerId: String): Boolean = channels.containsKey(savedServerId)

  @Synchronized fun servers(): Set<String> = channels.keys.toSet()

  @Synchronized fun clear() = channels.clear()

  @Synchronized fun size(): Int = channels.size
}
