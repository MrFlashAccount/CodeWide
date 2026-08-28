package dev.codewide.app.remote

import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket
import java.net.SocketAddress
import java.net.SocketException
import java.net.URI
import java.util.concurrent.CountDownLatch
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import javax.net.SocketFactory
import javax.net.ssl.SSLSocket
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import okio.ByteString.Companion.toByteString

/** Routes an ordinary OkHttp TLS socket through an opaque binary WebSocket. */
internal object InnerTlsTransport {
  const val PROTOCOL = "codewide-inner-tls-v1"
  const val TUNNEL_PATH = "/v1/e2ee-tunnel"

  fun client(base: OkHttpClient, saved: StoredNativeSession): OkHttpClient {
    val carrier = PinnedTls.client(base, saved.endpoint, null)
    return PinnedTls.innerTlsClient(
      base,
      saved.endpoint,
      saved.innerTlsPinSha256,
      TunnelSocketFactory(carrier, tunnelUrl(saved.endpoint)),
    )
  }

  fun url(saved: StoredNativeSession, url: String): String {
    val uri = URI(url)
    val scheme = when (uri.scheme) {
      "ws", "wss" -> "wss"
      "http", "https" -> "https"
      else -> error("Unsupported companion URL scheme")
    }
    return URI(scheme, uri.rawAuthority, uri.rawPath, uri.rawQuery, uri.rawFragment).toString()
  }

  fun openSocket(base: OkHttpClient, saved: StoredNativeSession, timeoutMs: Int): Socket {
    val carrier = PinnedTls.client(base, saved.endpoint, null)
    val raw = TunnelSocket(carrier, tunnelUrl(saved.endpoint))
    raw.connect(InetSocketAddress(requireNotNull(URI(saved.endpoint).host), 443), timeoutMs)
    return (PinnedTls.innerTlsSocketFactory(saved.innerTlsPinSha256)
      .createSocket(raw, requireNotNull(URI(saved.endpoint).host), 443, true) as SSLSocket).apply {
      startHandshake()
    }
  }

  fun bootstrap(endpoint: String, pin: String): StoredNativeSession = StoredNativeSession(
    id = "pairing-bootstrap",
    endpoint = endpoint,
    token = "bootstrap".repeat(4),
    tlsPinSha256 = pin,
    innerTlsPinSha256 = pin,
  )

  private fun tunnelUrl(endpoint: String): String {
    val uri = URI(endpoint)
    return URI(uri.scheme, uri.rawAuthority, TUNNEL_PATH, null, null).toString()
  }
}

private class TunnelSocketFactory(
  private val carrier: OkHttpClient,
  private val tunnelUrl: String,
) : SocketFactory() {
  override fun createSocket(): Socket = TunnelSocket(carrier, tunnelUrl)
  override fun createSocket(host: String, port: Int): Socket = createSocket().apply { connect(InetSocketAddress(host, port)) }
  override fun createSocket(host: String, port: Int, localHost: InetAddress, localPort: Int): Socket =
    createSocket(host, port)
  override fun createSocket(host: InetAddress, port: Int): Socket = createSocket(requireNotNull(host.hostAddress), port)
  override fun createSocket(address: InetAddress, port: Int, localAddress: InetAddress, localPort: Int): Socket =
    createSocket(address, port)
}

private sealed interface TunnelChunk {
  data class Bytes(val value: ByteArray) : TunnelChunk
  data class Failed(val error: IOException) : TunnelChunk
  data object End : TunnelChunk
}

private class TunnelSocket(
  private val carrier: OkHttpClient,
  private val tunnelUrl: String,
) : Socket() {
  private val opened = CountDownLatch(1)
  private val incoming = LinkedBlockingQueue<TunnelChunk>()
  private val closed = AtomicBoolean(false)
  @Volatile private var failure: IOException? = null
  @Volatile private var connected = false
  @Volatile private var readTimeoutMs = 0
  @Volatile private var webSocket: WebSocket? = null
  private val input = TunnelInputStream()
  private val output = TunnelOutputStream()

  override fun connect(endpoint: SocketAddress?) = connect(endpoint, DEFAULT_CONNECT_TIMEOUT_MS)

  override fun connect(endpoint: SocketAddress?, timeout: Int) {
    if (connected) return
    if (closed.get()) throw SocketException("Tunnel socket is closed")
    val request = Request.Builder().url(tunnelUrl).build()
    webSocket = carrier.newWebSocket(request, object : WebSocketListener() {
      override fun onOpen(webSocket: WebSocket, response: Response) {
        connected = true
        opened.countDown()
      }

      override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
        if (bytes.size > 0) incoming.offer(TunnelChunk.Bytes(bytes.toByteArray()))
      }

      override fun onMessage(webSocket: WebSocket, text: String) {
        fail(IOException("Secure tunnel returned a text frame"))
        webSocket.close(1003, "binary_frames_required")
      }

      override fun onClosed(webSocket: WebSocket, code: Int, reason: String) = end()

      override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
        fail(IOException("Secure tunnel failed${response?.let { " (${it.code})" }.orEmpty()}", t))
      }
    })
    val effectiveTimeout = if (timeout > 0) timeout else DEFAULT_CONNECT_TIMEOUT_MS
    if (!opened.await(effectiveTimeout.toLong(), TimeUnit.MILLISECONDS)) {
      close()
      throw SocketException("Secure tunnel connection timed out")
    }
    failure?.let { throw it }
    if (!connected) throw SocketException("Secure tunnel did not open")
  }

  override fun getInputStream(): InputStream = input
  override fun getOutputStream(): OutputStream = output
  override fun isConnected(): Boolean = connected
  override fun isClosed(): Boolean = closed.get()
  override fun getInetAddress(): InetAddress = InetAddress.getLoopbackAddress()
  override fun getLocalAddress(): InetAddress = InetAddress.getLoopbackAddress()
  override fun getPort(): Int = 443
  override fun getLocalPort(): Int = 0
  override fun setSoTimeout(timeout: Int) {
    readTimeoutMs = timeout
  }
  override fun getSoTimeout(): Int = readTimeoutMs
  override fun setTcpNoDelay(on: Boolean) = Unit
  override fun getTcpNoDelay(): Boolean = true
  override fun setKeepAlive(on: Boolean) = Unit
  override fun getKeepAlive(): Boolean = true
  // WebSocket has no half-close. TLS close_notify and the final WebSocket
  // close own shutdown; treating either half as a full close can truncate an
  // HTTP response that is still arriving on the other direction.
  override fun shutdownOutput() = Unit
  override fun shutdownInput() = Unit

  override fun close() {
    if (!closed.compareAndSet(false, true)) return
    connected = false
    webSocket?.close(1000, "inner_tls_closed")
    incoming.offer(TunnelChunk.End)
    opened.countDown()
  }

  private fun fail(error: IOException) {
    failure = error
    connected = false
    incoming.offer(TunnelChunk.Failed(error))
    opened.countDown()
  }

  private fun end() {
    connected = false
    incoming.offer(TunnelChunk.End)
    opened.countDown()
  }

  private inner class TunnelInputStream : InputStream() {
    private var current = ByteArray(0)
    private var offset = 0

    override fun read(): Int {
      val one = ByteArray(1)
      return if (read(one, 0, 1) < 0) -1 else one[0].toInt() and 0xff
    }

    override fun read(buffer: ByteArray, targetOffset: Int, length: Int): Int {
      if (length == 0) return 0
      while (offset >= current.size) {
        when (val chunk = takeChunk()) {
          is TunnelChunk.Bytes -> {
            current = chunk.value
            offset = 0
          }
          is TunnelChunk.Failed -> throw chunk.error
          TunnelChunk.End -> return -1
        }
      }
      val count = minOf(length, current.size - offset)
      current.copyInto(buffer, targetOffset, offset, offset + count)
      offset += count
      return count
    }

    private fun takeChunk(): TunnelChunk = if (readTimeoutMs > 0) {
      incoming.poll(readTimeoutMs.toLong(), TimeUnit.MILLISECONDS)
        ?: throw java.net.SocketTimeoutException("Secure tunnel read timed out")
    } else {
      incoming.take()
    }
  }

  private inner class TunnelOutputStream : OutputStream() {
    override fun write(value: Int) = write(byteArrayOf(value.toByte()))

    override fun write(buffer: ByteArray, offset: Int, length: Int) {
      if (closed.get() || !connected) throw SocketException("Secure tunnel is not connected")
      var cursor = offset
      val end = offset + length
      while (cursor < end) {
        val count = minOf(MAX_FRAME_BYTES, end - cursor)
        val active = webSocket ?: throw SocketException("Secure tunnel is not connected")
        while (!closed.get() && active.queueSize() > MAX_QUEUED_BYTES) Thread.sleep(2)
        if (closed.get() || !active.send(buffer.toByteString(cursor, count))) {
          throw SocketException("Secure tunnel send failed")
        }
        cursor += count
      }
    }
  }

  companion object {
    private const val DEFAULT_CONNECT_TIMEOUT_MS = 15_000
    private const val MAX_FRAME_BYTES = 64 * 1024
    private const val MAX_QUEUED_BYTES = 4L * 1024 * 1024
  }
}
