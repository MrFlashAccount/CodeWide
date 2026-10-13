package dev.codewide.app.remote

import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.URI
import java.nio.file.Files
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class NativeCompanionHttpTest {
  private val server = MockWebServer()
  private val directory: File = Files.createTempDirectory("companion-http").toFile()
  private val clientsCreated = AtomicInteger()
  private var saved = session("pin-a")
  private lateinit var http: NativeCompanionHttp

  @Before
  fun start() {
    server.start()
    http = NativeCompanionHttp(
      credentials = { id -> saved.takeIf { it.id == id } },
      clientFor = {
        clientsCreated.incrementAndGet()
        OkHttpClient.Builder().callTimeout(5, TimeUnit.SECONDS).build()
      },
      files = LocalFiles,
      originFor = { server.url("/").toString().toHttpUrl() },
    )
  }

  @After
  fun stop() {
    http.close()
    server.shutdown()
    directory.deleteRecursively()
  }

  @Test
  fun `sends the origin-relative path and returns status, headers and text`() {
    server.enqueue(MockResponse().setResponseCode(201).setHeader("x-upload-offset", "8").setBody("{\"ok\":true}"))

    val result = execute(request(
      method = "POST",
      path = "/v1/telemetry/events?batch=a%2Fb",
      headers = listOf("authorization" to "Bearer scoped", "content-type" to "application/json"),
      body = CompanionHttpBody.Text("{\"events\":[]}"),
    ))

    val recorded = server.takeRequest()
    assertEquals("/v1/telemetry/events?batch=a%2Fb", recorded.path)
    assertEquals("Bearer scoped", recorded.getHeader("authorization"))
    assertEquals("{\"events\":[]}", recorded.body.readUtf8())
    assertEquals(201, result.status)
    assertTrue(result.headers.contains("x-upload-offset" to "8"))
    assertEquals(CompanionHttpPayload.Text("{\"ok\":true}"), result.payload)
  }

  @Test
  fun `uploads exactly the requested file range`() {
    val source = file("upload.bin", "0123456789")
    server.enqueue(MockResponse().setResponseCode(308))

    execute(request(
      method = "PUT",
      path = "/v1/files/upload?rootId=r&path=a",
      body = CompanionHttpBody.FileSlice(source.toURI().toString(), offset = 3, length = 4),
    ))

    val recorded = server.takeRequest()
    assertEquals("3456", recorded.body.readUtf8())
    assertEquals("4", recorded.getHeader("content-length"))
  }

  @Test
  fun `fails an upload whose file is shorter than the requested range`() {
    val source = file("short.bin", "0123")
    server.enqueue(MockResponse().setResponseCode(308))

    val failure = executeFailure(request(
      method = "PUT",
      path = "/v1/files/upload?rootId=r&path=a",
      body = CompanionHttpBody.FileSlice(source.toURI().toString(), offset = 2, length = 4),
    ))

    assertTrue(failure is IOException)
  }

  @Test
  fun `writes and appends only successful download bodies`() {
    val destination = file("download.part", "01")
    server.enqueue(MockResponse().setResponseCode(206).setBody("2345"))
    server.enqueue(MockResponse().setResponseCode(404).setBody("{\"error\":\"file_not_found\"}"))

    val appended = execute(request(sink = CompanionHttpSink.File(destination.toURI().toString(), append = true)))
    val missing = execute(request(sink = CompanionHttpSink.File(destination.toURI().toString(), append = false)))

    assertEquals(CompanionHttpPayload.File(4), appended.payload)
    assertEquals(404, missing.status)
    assertEquals(CompanionHttpPayload.Text("{\"error\":\"file_not_found\"}"), missing.payload)
    assertEquals("012345", destination.readText())
  }

  @Test
  fun `bounds an error body and discards header-only exchanges`() {
    server.enqueue(MockResponse().setResponseCode(500).setBody("x".repeat(10_000)))
    server.enqueue(MockResponse().setHeader("x-upload-complete", "true"))

    val failed = execute(request(sink = CompanionHttpSink.File(File(directory, "unused").toURI().toString(), append = false)))
    val head = execute(request(method = "HEAD", sink = CompanionHttpSink.Discard))

    assertEquals(4 * 1024, (failed.payload as CompanionHttpPayload.Text).text.length)
    assertFalse(File(directory, "unused").exists())
    assertEquals(CompanionHttpPayload.None, head.payload)
    assertTrue(head.headers.contains("x-upload-complete" to "true"))
  }

  @Test
  fun `cancels an in-flight request by id`() {
    server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE))
    val done = CountDownLatch(1)
    var outcome: Result<CompanionHttpResult>? = null

    http.execute(request(requestId = "slow")) { outcome = it; done.countDown() }
    server.takeRequest(5, TimeUnit.SECONDS)
    http.cancel("slow")

    assertTrue(done.await(5, TimeUnit.SECONDS))
    assertTrue(outcome!!.exceptionOrNull() is IOException)
  }

  @Test
  fun `reuses one client per authority and replaces it when credentials change`() {
    repeat(3) { server.enqueue(MockResponse().setBody("ok")) }

    execute(request(requestId = "a"))
    execute(request(requestId = "b"))
    saved = session("pin-b")
    execute(request(requestId = "c"))

    assertEquals(2, clientsCreated.get())
  }

  @Test
  fun `rejects requests the transport must not forward`() {
    assertThrows(IllegalArgumentException::class.java) { request(path = "//evil.example/v1/x") }
    assertThrows(IllegalArgumentException::class.java) { request(path = "/v2/files") }
    assertThrows(IllegalArgumentException::class.java) { request(headers = listOf("Host" to "evil.example")) }
    assertThrows(IllegalArgumentException::class.java) { request(headers = listOf("x-a" to "1\r\nx-b: 2")) }
    assertThrows(IllegalArgumentException::class.java) { request(body = CompanionHttpBody.Text("x")) }
  }

  @Test
  fun `reports missing or disabled credentials without a network request`() {
    saved = session("pin-a").copy(enabled = false)

    assertTrue(executeFailure(request()) is IllegalArgumentException)
    assertTrue(executeFailure(request(connectionId = "unknown")) is IllegalStateException)
    assertEquals(0, server.requestCount)
  }

  @Test
  fun `streams a media view request through the pinned client with its headers and range`() {
    server.enqueue(MockResponse().setResponseCode(206).setHeader("content-range", "bytes 0-3/10").setBody("0123"))
    val address = requireNotNull(
      CompanionAddress.parse("https://companion.invalid/server-1/v1/media/${"a".repeat(64)}?v=2".toHttpUrl()),
    )
    val viewRequest = okhttp3.Request.Builder()
      .url("https://companion.invalid/server-1/v1/media/${"a".repeat(64)}?v=2")
      .header("authorization", "Bearer scoped")
      .header("range", "bytes=0-3")
      .build()

    http.proceed(address, viewRequest).use { response ->
      assertEquals(206, response.code)
      assertEquals("0123", response.body?.string())
    }
    val recorded = server.takeRequest()
    assertEquals("/v1/media/${"a".repeat(64)}?v=2", recorded.path)
    assertEquals("Bearer scoped", recorded.getHeader("authorization"))
    assertEquals("bytes=0-3", recorded.getHeader("range"))
  }

  @Test
  fun `parses only connection-scoped Companion addresses`() {
    assertEquals(
      CompanionAddress("saved server/1", "/v1/files/preview?path=%2Fa%20b"),
      CompanionAddress.parse("https://companion.invalid/saved%20server%2F1/v1/files/preview?path=%2Fa%20b".toHttpUrl()),
    )
    assertEquals(null, CompanionAddress.parse("https://example.com/server-1/v1/content/a".toHttpUrl()))
    assertEquals(null, CompanionAddress.parse("http://companion.invalid/server-1/v1/content/a".toHttpUrl()))
    assertFalse(isCompanionApiPath("/v2/content/a"))
    assertFalse(isCompanionApiPath("/v1/../secrets"))
    assertFalse(isCompanionApiPath("/v1/%2E%2e/secrets"))
    assertTrue(isCompanionApiPath("/v1/files/preview?path=%2Fa%2F..%2Fb"))
  }

  private fun execute(request: CompanionHttpRequest): CompanionHttpResult = await(request).getOrThrow()

  private fun executeFailure(request: CompanionHttpRequest): Throwable = requireNotNull(await(request).exceptionOrNull())

  private fun await(request: CompanionHttpRequest): Result<CompanionHttpResult> {
    val done = CountDownLatch(1)
    var outcome: Result<CompanionHttpResult>? = null
    http.execute(request) { outcome = it; done.countDown() }
    assertTrue(done.await(10, TimeUnit.SECONDS))
    return requireNotNull(outcome)
  }

  private fun file(name: String, contents: String): File = File(directory, name).apply { writeText(contents) }

  private fun request(
    requestId: String = "request",
    connectionId: String = "server-1",
    method: String = "GET",
    path: String = "/v1/content/abc",
    headers: List<Pair<String, String>> = emptyList(),
    body: CompanionHttpBody = CompanionHttpBody.None,
    sink: CompanionHttpSink = CompanionHttpSink.Text,
  ) = CompanionHttpRequest(requestId, connectionId, method, path, headers, body, sink)

  private fun session(pin: String) = StoredNativeSession(
    id = "server-1",
    endpoint = "wss://companion.example/v1/sync",
    token = "token",
    tlsPinSha256 = null,
    innerTlsPinSha256 = pin,
  )

  private object LocalFiles : NativeCompanionHttpFiles {
    override fun openInput(uri: String): InputStream = FileInputStream(File(URI(uri)))

    override fun openOutput(uri: String, append: Boolean): OutputStream = FileOutputStream(File(URI(uri)), append)
  }
}
