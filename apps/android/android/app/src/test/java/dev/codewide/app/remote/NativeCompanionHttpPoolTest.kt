package dev.codewide.app.remote

import java.io.InputStream
import java.io.OutputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import okhttp3.tls.HandshakeCertificates
import okhttp3.tls.HeldCertificate
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * The inner Companion connection negotiates HTTP/2, where cancelling one call only
 * resets its stream. A request that JavaScript abandoned must not leave its stalled
 * connection pooled for the retry.
 */
class NativeCompanionHttpPoolTest {
  private val certificate = HeldCertificate.Builder().addSubjectAlternativeName("localhost").build()
  private val serverCertificates = HandshakeCertificates.Builder().heldCertificate(certificate).build()
  private val clientCertificates = HandshakeCertificates.Builder().addTrustedCertificate(certificate.certificate).build()
  private val server = MockWebServer()
  private lateinit var http: NativeCompanionHttp

  @Before
  fun start() {
    server.useHttps(serverCertificates.sslSocketFactory(), false)
    server.protocols = listOf(Protocol.HTTP_2, Protocol.HTTP_1_1)
    server.start()
    val saved = StoredNativeSession(
      id = "server-1",
      endpoint = "wss://companion.example/v1/sync",
      token = "token",
      tlsPinSha256 = null,
      innerTlsPinSha256 = "pin",
    )
    http = NativeCompanionHttp(
      credentials = { id -> saved.takeIf { it.id == id } },
      clientFor = {
        OkHttpClient.Builder()
          .sslSocketFactory(clientCertificates.sslSocketFactory(), clientCertificates.trustManager)
          .readTimeout(30, TimeUnit.SECONDS)
          .build()
      },
      files = NoFiles,
      originFor = { server.url("/").toString().toHttpUrl() },
    )
  }

  @After
  fun stop() {
    http.close()
    server.shutdown()
  }

  @Test
  fun `a cancelled request does not leave its stalled connection for the retry`() {
    server.enqueue(MockResponse().setBody("status"))
    server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE))
    server.enqueue(MockResponse().setBody("check"))

    assertEquals(CompanionHttpPayload.Text("status"), execute("status").payload)
    val stalled = CountDownLatch(1)
    http.execute(request("stalled")) { stalled.countDown() }
    server.takeRequest(5, TimeUnit.SECONDS)
    server.takeRequest(5, TimeUnit.SECONDS)
    http.cancel("stalled")
    assertTrue(stalled.await(5, TimeUnit.SECONDS))

    assertEquals(CompanionHttpPayload.Text("check"), execute("retry").payload)
    assertEquals(0, server.takeRequest(5, TimeUnit.SECONDS)!!.sequenceNumber)
  }

  @Test
  fun `a network change retires idle pooled connections`() {
    server.enqueue(MockResponse().setBody("before"))
    server.enqueue(MockResponse().setBody("after"))

    execute("before")
    http.retireIdleConnections()
    execute("after")

    assertEquals(0, server.takeRequest(5, TimeUnit.SECONDS)!!.sequenceNumber)
    assertEquals(0, server.takeRequest(5, TimeUnit.SECONDS)!!.sequenceNumber)
  }

  private fun execute(requestId: String): CompanionHttpResult {
    val done = CountDownLatch(1)
    var outcome: Result<CompanionHttpResult>? = null
    http.execute(request(requestId)) { outcome = it; done.countDown() }
    assertTrue(done.await(10, TimeUnit.SECONDS))
    return requireNotNull(outcome).getOrThrow()
  }

  private fun request(requestId: String) = CompanionHttpRequest(
    requestId = requestId,
    connectionId = "server-1",
    method = "GET",
    path = "/v1/host-update",
    headers = emptyList(),
    body = CompanionHttpBody.None,
    sink = CompanionHttpSink.Text,
  )

  private object NoFiles : NativeCompanionHttpFiles {
    override fun openInput(uri: String): InputStream = error("No file bodies in this test")

    override fun openOutput(uri: String, append: Boolean): OutputStream = error("No file bodies in this test")
  }
}
