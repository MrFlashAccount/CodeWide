package dev.codewide.app.remote

import android.util.Base64
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import okio.ByteString.Companion.toByteString
import org.json.JSONObject
import java.io.BufferedOutputStream
import java.io.File
import java.io.FileOutputStream
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ScheduledThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/** Owns authenticated, certificate-pinned interactive terminal sockets. */
internal class NativeTerminalSessionManager(
  private val credentialsStore: NativeSessionCredentialsStore,
  private val credentialClient: OkHttpClient,
  private val socketClient: OkHttpClient,
  cacheDirectory: File,
) {
  private data class OutputChunk(
    val bytes: ByteArray,
    val nextOffset: Long,
    val hasMore: Boolean,
  )

  private class Transcript(directory: File, sessionId: String) {
    private val file = File(directory, "$sessionId.ansi")
    private var output: BufferedOutputStream? = null
    private var length = 0L

    init {
      directory.mkdirs()
      check(directory.isDirectory) { "Could not create terminal cache directory" }
      if (file.exists()) check(file.delete()) { "Could not reset terminal transcript" }
      output = BufferedOutputStream(FileOutputStream(file), TRANSCRIPT_WRITE_BUFFER_BYTES)
    }

    @Synchronized
    fun append(bytes: ByteString): Long {
      check(length + bytes.size <= MAX_TRANSCRIPT_BYTES) { "Terminal output exceeded the replay limit" }
      output?.write(bytes.toByteArray()) ?: error("Terminal transcript is closed")
      length += bytes.size
      return length
    }

    @Synchronized
    fun length(): Long = length

    @Synchronized
    fun read(offset: Long, maxBytes: Int): OutputChunk {
      require(offset in 0..length) { "Terminal output offset is invalid" }
      require(maxBytes in 1..MAX_READ_BYTES) { "Terminal output read size is invalid" }
      output?.flush()
      val count = minOf(maxBytes.toLong(), length - offset).toInt()
      val bytes = ByteArray(count)
      if (count > 0) {
        RandomAccessFile(file, "r").use { input ->
          input.seek(offset)
          input.readFully(bytes)
        }
      }
      val nextOffset = offset + count
      return OutputChunk(bytes, nextOffset, nextOffset < length)
    }

    @Synchronized
    fun finish() {
      output?.close()
      output = null
    }

    @Synchronized
    fun delete() {
      finish()
      if (file.exists()) file.delete()
    }
  }

  private data class Session(
    val id: String,
    val connectionId: String,
    val threadId: String,
    val cwd: String?,
    @Volatile var cols: Int,
    @Volatile var rows: Int,
    val transcript: Transcript,
    val disposed: AtomicBoolean = AtomicBoolean(false),
    val pending: ArrayDeque<ByteString> = ArrayDeque(),
    var pendingBytes: Long = 0,
    var socket: WebSocket? = null,
    var open: Boolean = false,
    var serverSessionCreated: Boolean = false,
    var reconnectScheduled: Boolean = false,
    var reconnectAttempt: Int = 0,
    var generation: Long = 0,
    @Volatile var finished: Boolean = false,
  )

  private val sessions = ConcurrentHashMap<String, Session>()
  private val transcriptDirectory = File(cacheDirectory, "terminal-sessions")
  private val reconnectExecutor = ScheduledThreadPoolExecutor(1).apply {
    removeOnCancelPolicy = true
  }

  init {
    transcriptDirectory.listFiles { file -> file.isFile && file.extension == "ansi" }
      ?.forEach { file -> file.delete() }
  }

  fun open(sessionId: String, connectionId: String, threadId: String, cwd: String?, cols: Int, rows: Int) {
    require(SESSION_ID.matches(sessionId)) { "Terminal session id is invalid" }
    require(connectionId.isNotBlank()) { "Connection id is required" }
    require(threadId.isNotBlank() && threadId.length <= MAX_THREAD_ID_CHARS) { "Thread id is invalid" }
    require(cwd == null || cwd.length in 1..MAX_CWD_CHARS) { "Terminal working directory is invalid" }
    require(cols in MIN_COLS..MAX_COLS && rows in MIN_ROWS..MAX_ROWS) { "Terminal size is invalid" }
    require(sessions.size < MAX_SESSIONS) { "Too many terminal sessions are open" }
    val saved = credentialsStore.get(connectionId) ?: error("Saved server credentials are missing")
    require(saved.enabled) { "Server connection is disabled" }
    val session = Session(
      id = sessionId,
      connectionId = connectionId,
      threadId = threadId,
      cwd = cwd,
      cols = cols,
      rows = rows,
      transcript = Transcript(transcriptDirectory, sessionId),
    )
    check(sessions.putIfAbsent(session.id, session) == null) { "Could not allocate terminal session" }
    beginConnect(session, 0)
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
    val session = sessions[sessionId] ?: error("Terminal session is closed")
    session.cols = cols
    session.rows = rows
    send(sessionId, payload.toByteString())
  }

  fun close(sessionId: String) {
    val session = sessions.remove(sessionId) ?: return
    if (!session.disposed.compareAndSet(false, true)) return
    synchronized(session) {
      session.pending.clear()
      session.pendingBytes = 0
      session.socket?.send(byteArrayOf(CLOSE_OPCODE).toByteString())
      session.socket?.close(1000, "terminal_closed")
      session.socket = null
      session.open = false
      session.finished = true
    }
    session.transcript.delete()
    emit(session, "removed")
  }

  fun readOutput(sessionId: String, offset: Long, maxBytes: Int): String {
    val session = sessions[sessionId] ?: error("Terminal session is unavailable")
    val chunk = session.transcript.read(offset, maxBytes)
    return JSONObject()
      .put("data", Base64.encodeToString(chunk.bytes, Base64.NO_WRAP))
      .put("nextOffset", chunk.nextOffset)
      .put("hasMore", chunk.hasMore)
      .put("finished", session.finished)
      .toString()
  }

  fun closeConnection(connectionId: String) {
    sessions.values.filter { it.connectionId == connectionId }.forEach { close(it.id) }
  }

  fun reconnectConnection(connectionId: String) {
    sessions.values
      .filter { it.connectionId == connectionId && !it.disposed.get() && !it.finished }
      .forEach { session ->
        synchronized(session) {
          session.generation += 1
          session.reconnectScheduled = false
          session.socket?.cancel()
          session.socket = null
          session.open = false
        }
        beginConnect(session, 0L)
      }
  }

  fun closeAll() {
    sessions.keys.toList().forEach(::close)
  }

  fun destroy() {
    closeAll()
    reconnectExecutor.shutdownNow()
  }

  private fun beginConnect(session: Session, delayMillis: Long) {
    val generation = synchronized(session) {
      if (session.disposed.get() || session.finished || session.reconnectScheduled) return
      session.reconnectScheduled = true
      session.generation += 1
      session.generation
    }
    emit(session, if (delayMillis == 0L) "connecting" else "reconnecting")
    reconnectExecutor.schedule({
      synchronized(session) {
        if (session.disposed.get() || session.finished || session.generation != generation) return@schedule
        session.reconnectScheduled = false
      }
      val saved = credentialsStore.get(session.connectionId)
      if (saved == null || !saved.enabled) {
        fail(session, "Saved server credentials are unavailable")
        return@schedule
      }
      SessionCredentialClient.mint(credentialClient, saved) { result ->
        if (session.disposed.get() || session.finished || session.generation != generation) return@mint
        result.fold(
          onSuccess = { credential -> connect(session, saved, credential, generation) },
          onFailure = { scheduleReconnect(session, it.message ?: "Terminal authorization failed") },
        )
      }
    }, delayMillis, TimeUnit.MILLISECONDS)
  }

  private fun connect(
    session: Session,
    saved: StoredNativeSession,
    credential: MintedSessionCredential,
    generation: Long,
  ) {
    if (session.disposed.get() || session.finished || session.generation != generation) return
    val endpoint = InnerTlsTransport.url(saved, terminalEndpoint(
      saved.endpoint,
      session.threadId,
      session.cwd,
      session.cols,
      session.rows,
      session.id,
      session.transcript.length(),
      !session.serverSessionCreated,
    ))
    val request = Request.Builder()
      .url(endpoint)
      .header("Authorization", "Bearer ${credential.token}")
      .build()
    val client = InnerTlsTransport.client(socketClient, saved)
    val socket = client.newWebSocket(request, object : WebSocketListener() {
      override fun onOpen(socket: WebSocket, response: Response) {
        if (session.disposed.get() || session.finished || session.generation != generation) {
          socket.close(1000, "terminal_closed")
          return
        }
        synchronized(session) {
          if (session.socket !== socket) {
            socket.close(1000, "terminal_replaced")
            return
          }
          session.open = true
          session.serverSessionCreated = true
          session.reconnectAttempt = 0
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
        if (session.socket !== socket || session.generation != generation) return
        try {
          val offset = session.transcript.append(bytes)
          emit(session, "output", offset = offset)
        } catch (error: Throwable) {
          fail(session, error.message ?: "Could not cache terminal output")
        }
      }

      override fun onMessage(socket: WebSocket, text: String) {
        if (session.socket !== socket || session.generation != generation) return
        fail(session, "Terminal server returned an invalid text frame")
      }

      override fun onClosed(socket: WebSocket, code: Int, reason: String) {
        if (session.disposed.get() || session.socket !== socket || session.generation != generation) return
        synchronized(session) {
          session.socket = null
          session.open = false
        }
        if (code == TERMINAL_EXITED_CODE) {
          finish(session, "closed", code, reason)
        } else if (code == TERMINAL_REPLAY_UNAVAILABLE_CODE) {
          fail(session, "Terminal output replay is no longer available")
        } else {
          scheduleReconnect(session, reason.ifBlank { "Terminal connection closed" })
        }
      }

      override fun onFailure(socket: WebSocket, error: Throwable, response: Response?) {
        if (session.disposed.get() || session.socket !== socket || session.generation != generation) return
        synchronized(session) {
          session.socket = null
          session.open = false
        }
        val message = when (response?.code) {
          403 -> "Terminal access requires the shell.explicit device scope"
          400 -> "Terminal working directory or size was rejected"
          404 -> if (session.serverSessionCreated) {
            "Remote terminal session no longer exists"
          } else {
            "Terminal thread is unavailable"
          }
          409 -> "Terminal output replay is no longer available"
          422 -> "Terminal session belongs to another thread"
          else -> error.message ?: "Terminal connection failed"
        }
        if (response?.code in setOf(400, 403, 404, 409, 422)) fail(session, message)
        else scheduleReconnect(session, message)
      }
    })
    synchronized(session) {
      if (session.disposed.get()) socket.close(1000, "terminal_closed") else session.socket = socket
    }
  }

  private fun scheduleReconnect(session: Session, reason: String) {
    val delay = synchronized(session) {
      if (session.disposed.get() || session.finished || session.reconnectScheduled) return
      session.socket?.cancel()
      session.socket = null
      session.open = false
      val attempt = session.reconnectAttempt.coerceAtMost(RECONNECT_DELAYS_MILLIS.lastIndex)
      session.reconnectAttempt += 1
      RECONNECT_DELAYS_MILLIS[attempt]
    }
    emit(session, "reconnecting", message = reason.take(500))
    beginConnect(session, delay)
  }

  private fun send(sessionId: String, bytes: ByteString) {
    val session = sessions[sessionId] ?: error("Terminal session is closed")
    check(!session.disposed.get() && !session.finished) { "Terminal session is closed" }
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
    if (session.disposed.get() || session.finished) return
    synchronized(session) {
      session.pending.clear()
      session.pendingBytes = 0
      session.socket?.cancel()
      session.socket = null
      session.open = false
      session.finished = true
    }
    session.transcript.finish()
    emit(session, "error", message = message.take(500))
  }

  private fun finish(session: Session, type: String, code: Int, message: String) {
    if (session.disposed.get() || session.finished) return
    synchronized(session) {
      session.socket = null
      session.open = false
      session.finished = true
    }
    session.transcript.finish()
    emit(session, type, code = code, message = message)
  }

  private fun emit(
    session: Session,
    type: String,
    code: Int? = null,
    message: String? = null,
    offset: Long? = null,
  ) {
    val event = JSONObject()
      .put("sessionId", session.id)
      .put("connectionId", session.connectionId)
      .put("threadId", session.threadId)
      .put("type", type)
    if (code != null) event.put("code", code)
    if (message != null) event.put("message", message)
    if (offset != null) event.put("offset", offset)
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
    private const val MAX_THREAD_ID_CHARS = 512
    private const val MAX_INPUT_BYTES = 1024 * 1024
    private const val MAX_PENDING_BYTES = 1024L * 1024
    private const val MAX_TRANSCRIPT_BYTES = 128L * 1024 * 1024
    private const val MAX_READ_BYTES = 256 * 1024
    private const val TRANSCRIPT_WRITE_BUFFER_BYTES = 64 * 1024
    private const val MAX_SESSIONS = 8
    private const val TERMINAL_EXITED_CODE = 4000
    private const val TERMINAL_REPLAY_UNAVAILABLE_CODE = 4004
    private val RECONNECT_DELAYS_MILLIS = longArrayOf(250, 500, 1_000, 2_000, 5_000)
    private val SESSION_ID = Regex("terminal-[0-9a-fA-F-]{36}")
    private val CODEX_THREAD_ID = Regex("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")

    private fun frame(opcode: Byte, payload: ByteArray): ByteString =
      ByteArray(payload.size + 1).also { frame ->
        frame[0] = opcode
        payload.copyInto(frame, 1)
      }.toByteString()

    internal fun terminalEndpoint(
      syncEndpoint: String,
      threadId: String,
      cwd: String?,
      cols: Int,
      rows: Int,
      sessionId: String,
      offset: Long,
      create: Boolean,
    ): String {
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
        .apply {
          if (CODEX_THREAD_ID.matches(threadId)) addQueryParameter("threadId", threadId)
          else if (cwd != null) addQueryParameter("cwd", cwd)
        }
        .addQueryParameter("cols", cols.toString())
        .addQueryParameter("rows", rows.toString())
        .addQueryParameter("sessionId", sessionId)
        .addQueryParameter("offset", offset.toString())
        .addQueryParameter("create", create.toString())
        .build()
        .toString()
      return terminal.replaceFirst(
        if (websocketScheme == "wss") "https://" else "http://",
        "$websocketScheme://",
      )
    }
  }
}
