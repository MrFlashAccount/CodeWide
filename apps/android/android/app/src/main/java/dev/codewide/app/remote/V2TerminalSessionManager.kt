package dev.codewide.app.remote

import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/** Owns typed V2 Terminal framing while the connection service owns authentication and transport. */
internal class V2TerminalSessionManager(
  private val service: () -> CodexConnectionService,
  private val emit: (String, V2TerminalServerRecord) -> Unit,
  private val fail: (String, String) -> Unit,
) {
  private data class Session(
    val id: String,
    val savedServerId: String,
    val leaseHandle: String,
    val channelId: String,
    val openingRecord: String,
  )

  private val sessions = ConcurrentHashMap<String, Session>()

  fun open(sessionId: String, savedServerId: String, openingRecord: String) {
    require(sessions.size < MAX_SESSIONS) { "Too many V2 Terminal sessions are open" }
    val owner = service()
    val leaseHandle = owner.acquireAuthenticatedTransportLease(savedServerId)
    val session = Session(sessionId, savedServerId, leaseHandle, UUID.randomUUID().toString(), openingRecord)
    if (sessions.putIfAbsent(sessionId, session) != null) {
      owner.releaseAuthenticatedTransportLease(leaseHandle)
      error("V2 Terminal session already exists")
    }
    try {
      owner.openAuthenticatedDuplex(leaseHandle, session.channelId, "terminal-v2") { event -> receive(session, event) }
    } catch (error: Throwable) {
      terminate(session, "channel_open_failed")
      throw error
    }
  }

  fun input(sessionId: String, data: String) = send(sessionId, V2TerminalFrameCodec.input(data))

  fun resize(sessionId: String, cols: Int, rows: Int) = send(sessionId, V2TerminalFrameCodec.resize(cols, rows))

  fun close(sessionId: String) {
    val session = sessions.remove(sessionId) ?: return
    val owner = runCatching(service).getOrNull() ?: return
    runCatching { owner.sendAuthenticatedDuplex(session.leaseHandle, session.channelId, V2TerminalFrameCodec.close()) }
    owner.closeAuthenticatedDuplex(session.leaseHandle, session.channelId, 1000, "terminal_closed")
    owner.releaseAuthenticatedTransportLease(session.leaseHandle)
  }

  fun closeSavedServer(savedServerId: String) {
    sessions.values.filter { it.savedServerId == savedServerId }.map { it.id }.forEach(::close)
  }

  fun closeAll() = sessions.keys.toList().forEach(::close)

  private fun receive(session: Session, event: AuthenticatedDuplexEvent) {
    if (sessions[session.id] !== session) return
    when (event.type) {
      "open" -> send(session.id, session.openingRecord)
      "message" -> {
        val record = try {
          V2TerminalFrameCodec.decodeServer(requireNotNull(event.data))
        } catch (_: Throwable) {
          terminate(session, "invalid_server_record")
          return
        }
        emit(session.id, record)
        if (record is V2TerminalServerRecord.Exited || record is V2TerminalServerRecord.Error) close(session.id)
      }
      "binary" -> terminate(session, "binary_frame")
      "close" -> terminate(session, "closed_${event.code ?: 0}")
      "error" -> terminate(session, event.data ?: "transport_failed")
    }
  }

  private fun send(sessionId: String, record: String) {
    val session = sessions[sessionId] ?: error("V2 Terminal session is unavailable")
    service().sendAuthenticatedDuplex(session.leaseHandle, session.channelId, record)
  }

  private fun terminate(session: Session, reason: String) {
    if (!sessions.remove(session.id, session)) return
    val owner = runCatching(service).getOrNull()
    owner?.closeAuthenticatedDuplex(session.leaseHandle, session.channelId, 1000, "terminal_failed")
    owner?.releaseAuthenticatedTransportLease(session.leaseHandle)
    fail(session.id, reason.take(64))
  }

  private companion object {
    const val MAX_SESSIONS = 8
  }
}
