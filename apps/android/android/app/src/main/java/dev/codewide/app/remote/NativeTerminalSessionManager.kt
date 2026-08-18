package dev.codewide.app.remote

import android.util.Base64
import okhttp3.CertificatePinner
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import okio.ByteString.Companion.toByteString
import org.json.JSONObject
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean

/** Owns authenticated, certificate-pinned interactive terminal sockets. */
internal class NativeTerminalSessionManager(
  private val credentialsStore: NativeSessionCredentialsStore,
  private val credentialClient: OkHttpClient,
  private val socketClient: OkHttpClient,
) {
  private data class Session(
    val id: String,
    val connectionId: String,
    val closed: AtomicBoolean = AtomicBoolean(false),
    val pending: ArrayDeque<ByteString> = ArrayDeque(),
    var pendingBytes: Long = 0,
    var socket: WebSocket? = null,
    var open: Boolean = false,
  )

  private val sessions = ConcurrentHashMap<String, Session>()

  fun open(sessionId: String, connectionId: String, cwd: String?, cols: Int, rows: Int) {
    require(SESSION_ID.matches(sessionId)) { "Terminal session id is invalid" }
    require(connectionId.isNotBlank()) { "Connection id is required" }
    require(cwd == null || cwd.length in 1..MAX_CWD_CHARS) { "Terminal working directory is invalid" }
    require(cols in MIN_COLS..MAX_COLS && rows in MIN_ROWS..MAX_ROWS) { "Terminal size is invalid" }
    require(sessions.size < MAX_SESSIONS) { "Too many terminal sessions are open" }
    val saved = credentialsStore.get(connectionId) ?: error("Saved server credentials are missing")
    require(saved.enabled) { "Server connection is disabled" }
    val session = Session(id = sessionId, connectionId = connectionId)
    check(sessions.putIfAbsent(session.id, session) == null) { "Could not allocate terminal session" }
    emit(session, "connecting")
    SessionCredentialClient.mint(credentialClient, saved.endpoint, saved.token, saved.tlsPinSha256) { result ->
      result.fold(
        onSuccess = { credential -> connect(session, saved, credential, cwd, cols, rows) },
        onFailure = { error -> fail(session, error.message ?: "Terminal authorization failed") },
      )
    }
  }

  fun write(sessionId: String, base64: String) {
    val bytes = try {
      Base64.decode(base64, Base64.DEFAULT)
    } catch (error: IllegalArgumentException) {
      throw IllegalArgumentException("Terminal input is not valid base64", error)
    }
    require(bytes.size <= MAX_INPUT_BYTES) { "Terminal input is too large" }
    send(sessionId, frame(INPUT_OPCODE, bytes))
  }

  fun resize(sessionId: String, cols: Int, rows: Int) {
    require(cols in MIN_COLS..MAX_COLS && rows in MIN_ROWS..MAX_ROWS) { "Terminal size is invalid" }
    val payload = ByteBuffer.allocate(5).order(ByteOrder.BIG_ENDIAN)
      .put(RESIZE_OPCODE)
      .putShort(cols.toShort())
      .putShort(rows.toShort())
      .array()
    send(sessionId, payload.toByteString())
  }

  fun close(sessionId: String) {
    val session = sessions.remove(sessionId) ?: return
    if (!session.closed.compareAndSet(false, true)) return
    synchronized(session) {
      session.pending.clear()
      session.pendingBytes = 0
      session.socket?.send(byteArrayOf(CLOSE_OPCODE).toByteString())
      session.socket?.close(1000, "terminal_closed")
      session.socket = null
      session.open = false
    }
    emit(session, "closed")
  }

  fun closeConnection(connectionId: String) {
    sessions.values.filter { it.connectionId == connectionId }.forEach { close(it.id) }
  }

  fun closeAll() {
    sessions.keys.toList().forEach(::close)
  }

  private fun connect(
    session: Session,
    saved: StoredNativeSession,
    credential: MintedSessionCredential,
    cwd: String?,
    cols: Int,
    rows: Int,
  ) {
    if (session.closed.get()) return
    val endpoint = terminalEndpoint(saved.endpoint, cwd, cols, rows)
    val request = Request.Builder()
      .url(endpoint)
      .header("Authorization", "Bearer ${credential.token}")
      .build()
    val client = if (saved.tlsPinSha256 == null) socketClient else {
      socketClient.newBuilder()
        .certificatePinner(CertificatePinner.Builder().add(request.url.host, saved.tlsPinSha256).build())
        .build()
    }
    val socket = client.newWebSocket(request, object : WebSocketListener() {
      override fun onOpen(socket: WebSocket, response: Response) {
        if (session.closed.get()) {
          socket.close(1000, "terminal_closed")
          return
        }
        synchronized(session) {
          session.open = true
          while (session.pending.isNotEmpty()) {
            val pending = session.pending.removeFirst()
            session.pendingBytes -= pending.size
            if (!socket.send(pending)) {
              fail(session, "Terminal connection closed while sending input")
              return
            }
          }
        }
        emit(session, "open")
      }

      override fun onMessage(socket: WebSocket, bytes: ByteString) {
        emit(session, "output", Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP))
      }

      override fun onMessage(socket: WebSocket, text: String) {
        fail(session, "Terminal server returned an invalid text frame")
      }

      override fun onClosed(socket: WebSocket, code: Int, reason: String) {
        if (sessions.remove(session.id, session) && session.closed.compareAndSet(false, true)) {
          emit(session, "closed", null, code, reason)
        }
      }

      override fun onFailure(socket: WebSocket, error: Throwable, response: Response?) {
        val message = when (response?.code) {
          403 -> "Terminal access requires the shell.explicit device scope"
          400 -> "Terminal working directory or size was rejected"
          else -> error.message ?: "Terminal connection failed"
        }
        fail(session, message)
      }
    })
    synchronized(session) {
      if (session.closed.get()) socket.close(1000, "terminal_closed") else session.socket = socket
    }
  }

  private fun send(sessionId: String, bytes: ByteString) {
    val session = sessions[sessionId] ?: error("Terminal session is closed")
    check(!session.closed.get()) { "Terminal session is closed" }
    synchronized(session) {
      val socket = session.socket
      if (session.open && socket != null) {
        check(socket.send(bytes)) { "Terminal connection is closed" }
        return
      }
      require(session.pendingBytes + bytes.size <= MAX_PENDING_BYTES) { "Terminal input queue is full" }
      session.pending.addLast(bytes)
      session.pendingBytes += bytes.size
    }
  }

  private fun fail(session: Session, message: String) {
    sessions.remove(session.id, session)
    if (!session.closed.compareAndSet(false, true)) return
    synchronized(session) {
      session.pending.clear()
      session.pendingBytes = 0
      session.socket?.cancel()
      session.socket = null
      session.open = false
    }
    emit(session, "error", null, null, message.take(500))
  }

  private fun emit(
    session: Session,
    type: String,
    data: String? = null,
    code: Int? = null,
    message: String? = null,
  ) {
    val event = JSONObject()
      .put("sessionId", session.id)
      .put("connectionId", session.connectionId)
      .put("type", type)
    if (data != null) event.put("data", data)
    if (code != null) event.put("code", code)
    if (message != null) event.put("message", message)
    CodeWideModule.emitTerminalEvent(event.toString())
  }

  companion object {
    private const val INPUT_OPCODE: Byte = 0
    private const val RESIZE_OPCODE: Byte = 1
    private const val CLOSE_OPCODE: Byte = 2
    private const val MIN_COLS = 2
    private const val MAX_COLS = 500
    private const val MIN_ROWS = 2
    private const val MAX_ROWS = 300
    private const val MAX_CWD_CHARS = 4096
    private const val MAX_INPUT_BYTES = 1024 * 1024
    private const val MAX_PENDING_BYTES = 1024L * 1024
    private const val MAX_SESSIONS = 8
    private val SESSION_ID = Regex("terminal-[0-9a-fA-F-]{36}")

    private fun frame(opcode: Byte, payload: ByteArray): ByteString =
      ByteArray(payload.size + 1).also { frame ->
        frame[0] = opcode
        payload.copyInto(frame, 1)
      }.toByteString()

    internal fun terminalEndpoint(syncEndpoint: String, cwd: String?, cols: Int, rows: Int): String {
      val websocketScheme = when {
        syncEndpoint.startsWith("wss://") -> "wss"
        syncEndpoint.startsWith("ws://") -> "ws"
        else -> error("Server endpoint is invalid")
      }
      val httpEndpoint = syncEndpoint.replaceFirst(
        if (websocketScheme == "wss") "wss://" else "ws://",
        if (websocketScheme == "wss") "https://" else "http://",
      )
      val sync = httpEndpoint.toHttpUrl()
      require(sync.encodedPath == "/v1/sync") { "Server endpoint is invalid" }
      val terminal = sync.newBuilder()
        .encodedPath("/v1/terminals")
        .query(null)
        .apply { if (cwd != null) addQueryParameter("cwd", cwd) }
        .addQueryParameter("cols", cols.toString())
        .addQueryParameter("rows", rows.toString())
        .build()
        .toString()
      return terminal.replaceFirst(
        if (websocketScheme == "wss") "https://" else "http://",
        "$websocketScheme://",
      )
    }
  }
}
