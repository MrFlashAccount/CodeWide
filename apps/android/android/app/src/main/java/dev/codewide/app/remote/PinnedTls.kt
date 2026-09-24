package dev.codewide.app.remote

import java.net.URI
import java.security.MessageDigest
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocketFactory
import javax.net.ssl.X509ExtendedKeyManager
import javax.net.ssl.X509TrustManager
import javax.net.SocketFactory
import okhttp3.OkHttpClient
import okio.ByteString.Companion.toByteString

/** Outer carrier validation plus the pinned inner Companion TLS boundary. */
internal object PinnedTls {
  private val PIN_PATTERN = Regex("^sha256/[A-Za-z0-9+/]{43}=$")

  fun requireTransport(endpoint: String, pin: String?): URI {
    val uri = URI(endpoint)
    require(uri.scheme == "ws" || uri.scheme == "wss") { "Endpoint must use ws or wss" }
    require(pin == null || PIN_PATTERN.matches(pin)) { "Companion identity pin is invalid" }
    if (uri.scheme == "ws") {
      require(isLocalDevelopmentHost(uri.host) || isExplicitRelayRoute(uri.path)) {
        "Cleartext WebSocket is only allowed for local development or an explicit inner-TLS relay route"
      }
    }
    return uri
  }

  fun client(base: OkHttpClient, endpoint: String, pin: String?): OkHttpClient {
    requireTransport(endpoint, pin)
    // The outer endpoint belongs to the relay/public ingress. Its ordinary TLS
    // is useful defense in depth, but the saved Companion pin is deliberately
    // checked only by inner TLS so a relay never needs the Companion key.
    return base
  }

  fun requireRelayEndpoint(endpoint: String, relay: PinnedRelayRoute?) {
    if (relay == null) return
    val uri = requireTransport(endpoint, null)
    require(uri.scheme == "wss" && uri.path == "/v1/sync") { "Pinned Relay requires WSS /v1/sync" }
  }

  fun carrierClient(base: OkHttpClient, endpoint: String, relay: PinnedRelayRoute?): OkHttpClient {
    requireRelayEndpoint(endpoint, relay)
    if (relay == null) return client(base, endpoint, null)
    val trustManager = RelayPinTrustManager(relay.tlsPinSha256)
    val context = SSLContext.getInstance("TLSv1.3")
    context.init(null, arrayOf(trustManager), null)
    val expectedHost = requireNotNull(URI(endpoint).host)
    return base.newBuilder()
      .sslSocketFactory(context.socketFactory, trustManager)
      .hostnameVerifier { host, _ -> host.equals(expectedHost, ignoreCase = true) }
      .build()
  }

  internal fun pinForCertificate(certificate: X509Certificate): String =
    "sha256/${certificate.encoded.toByteString().sha256().base64()}"

  private class RelayPinTrustManager(private val expectedPin: String) : X509TrustManager {
    override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) {
      throw CertificateException("Relay transport does not accept client certificates")
    }

    override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {
      if (chain.isNullOrEmpty()) throw CertificateException("Relay certificate chain is empty")
      chain[0].checkValidity()
      if (!MessageDigest.isEqual(pinForCertificate(chain[0]).toByteArray(), expectedPin.toByteArray())) {
        throw CertificateException("Relay certificate pin mismatch")
      }
    }

    override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
  }

  fun socketFactory(endpoint: String, pin: String?): SSLSocketFactory {
    val uri = requireTransport(endpoint, pin)
    require(uri.scheme == "wss") { "TLS socket requires WSS" }
    if (pin == null) return SSLSocketFactory.getDefault() as SSLSocketFactory
    val trustManager = PinTrustManager(requireNotNull(pin))
    return SSLContext.getInstance("TLS").apply {
      init(null, arrayOf(trustManager), null)
    }.socketFactory
  }

  fun innerTlsClient(
    base: OkHttpClient,
    endpoint: String,
    pin: String,
    tunnelSocketFactory: SocketFactory,
    keyManager: X509ExtendedKeyManager?,
  ): OkHttpClient {
    val uri = URI(endpoint)
    require(uri.scheme == "ws" || uri.scheme == "wss") { "Endpoint must use ws or wss" }
    require(PIN_PATTERN.matches(pin)) { "Inner TLS identity pin is invalid" }
    val trustManager = PinTrustManager(pin)
    val sslContext = SSLContext.getInstance("TLSv1.3")
    sslContext.init(keyManager?.let { arrayOf<javax.net.ssl.KeyManager>(it) }, arrayOf(trustManager), null)
    val expectedHost = requireNotNull(uri.host)
    return base.newBuilder()
      .socketFactory(tunnelSocketFactory)
      .sslSocketFactory(Tls13SocketFactory(sslContext.socketFactory), trustManager)
      .hostnameVerifier { hostname, _ -> hostname.equals(expectedHost, ignoreCase = true) }
      // PinTrustManager verifies the exact leaf SPKI during the TLS handshake.
      // Do not duplicate that check with OkHttp CertificatePinner: Android's
      // provider does not expose the peer chain back to OkHttp for an
      // SSLSocket layered over our WebSocket-backed Socket, so the redundant
      // post-handshake check rejects a certificate that was already pinned.
      .build()
  }

  fun innerTlsSocketFactory(pin: String, keyManager: X509ExtendedKeyManager?): SSLSocketFactory {
    require(PIN_PATTERN.matches(pin)) { "Inner TLS identity pin is invalid" }
    val trustManager = PinTrustManager(pin)
    return Tls13SocketFactory(SSLContext.getInstance("TLSv1.3").apply {
      init(keyManager?.let { arrayOf<javax.net.ssl.KeyManager>(it) }, arrayOf(trustManager), null)
    }.socketFactory)
  }

  internal fun pinFor(certificate: X509Certificate): String = pinForSpki(certificate.publicKey.encoded)

  internal fun pinForSpki(spki: ByteArray): String = "sha256/${spki.toByteString().sha256().base64()}"

  private fun isLocalDevelopmentHost(host: String?): Boolean =
    host == "127.0.0.1" || host == "localhost" || host == "::1" || host == "[::1]" || host == "10.0.2.2"

  private fun isExplicitRelayRoute(path: String): Boolean =
    Regex("^/c/[a-f0-9]{64}/v1/sync$").matches(path)

  private class PinTrustManager(private val expectedPin: String) : X509TrustManager {
    override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) {
      throw CertificateException("Companion transport does not accept client certificates")
    }

    override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {
      if (chain.isNullOrEmpty()) throw CertificateException("Companion certificate chain is empty")
      chain[0].checkValidity()
      // The Companion identity is the TLS leaf. Never accept a match on an
      // unrelated certificate appended by the peer later in the chain.
      val matched = MessageDigest.isEqual(
        pinFor(chain[0]).toByteArray(),
        expectedPin.toByteArray(),
      )
      if (!matched) throw CertificateException("Companion identity pin mismatch")
    }

    override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
  }

  private class Tls13SocketFactory(private val delegate: SSLSocketFactory) : SSLSocketFactory() {
    override fun getDefaultCipherSuites(): Array<String> = delegate.defaultCipherSuites
    override fun getSupportedCipherSuites(): Array<String> = delegate.supportedCipherSuites
    override fun createSocket(socket: java.net.Socket, host: String, port: Int, autoClose: Boolean): java.net.Socket =
      configure(delegate.createSocket(socket, host, port, autoClose))
    override fun createSocket(host: String, port: Int): java.net.Socket = configure(delegate.createSocket(host, port))
    override fun createSocket(host: String, port: Int, local: java.net.InetAddress, localPort: Int): java.net.Socket =
      configure(delegate.createSocket(host, port, local, localPort))
    override fun createSocket(host: java.net.InetAddress, port: Int): java.net.Socket = configure(delegate.createSocket(host, port))
    override fun createSocket(host: java.net.InetAddress, port: Int, local: java.net.InetAddress, localPort: Int): java.net.Socket =
      configure(delegate.createSocket(host, port, local, localPort))

    private fun configure(socket: java.net.Socket): java.net.Socket = socket.apply {
      (this as javax.net.ssl.SSLSocket).enabledProtocols = arrayOf("TLSv1.3")
    }
  }
}
