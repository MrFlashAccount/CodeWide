package dev.codewide.app.remote

import java.io.IOException
import java.util.concurrent.TimeUnit
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.tls.HandshakeCertificates
import okhttp3.tls.HeldCertificate
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class DirectCompanionTlsTest {
  @Test
  fun `direct Mac accepts the QR identity and rejects a different identity`() {
    // The Mac certificate names its identity, not its current Wi-Fi IP address.
    val identity = HeldCertificate.Builder().commonName("codewide-companion").build()
    val server = MockWebServer()
    server.useHttps(HandshakeCertificates.Builder().heldCertificate(identity).build().sslSocketFactory(), false)
    server.start()
    try {
      val endpoint = "wss://127.0.0.1:${server.port}/v1/sync"
      val base = OkHttpClient.Builder().callTimeout(5, TimeUnit.SECONDS).build()
      val request = Request.Builder().url("https://127.0.0.1:${server.port}/probe").build()
      val client = PinnedTls.carrierClient(base, endpoint, null, PinnedTls.pinFor(identity.certificate))
      server.enqueue(MockResponse().setBody("direct"))
      client.newCall(request).execute().use { response ->
        assertEquals("direct", response.body?.string())
      }
      val wrong = HeldCertificate.Builder().commonName("different-companion").build()
      val rejected = PinnedTls.carrierClient(base, endpoint, null, PinnedTls.pinFor(wrong.certificate))
      assertThrows(IOException::class.java) { rejected.newCall(request).execute().close() }
      assertThrows(IOException::class.java) {
        PinnedTls.carrierClient(base, endpoint, null).newCall(request).execute().close()
      }
    } finally {
      server.shutdown()
    }
  }
}
