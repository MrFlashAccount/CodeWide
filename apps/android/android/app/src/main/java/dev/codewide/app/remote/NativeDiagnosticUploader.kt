package dev.codewide.app.remote

import dev.codewide.app.diagnostics.NativeDiagnosticRuntime
import dev.codewide.app.diagnostics.DiagnosticJournal
import java.io.File
import java.io.IOException
import java.net.URI
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody
import org.json.JSONObject

/** Native retry owner. Failed, interrupted, old-server and unacknowledged uploads stay on disk. */
internal class NativeDiagnosticUploader(private val credentials: NativeSessionCredentialsStore) : AutoCloseable {
  private val executor = Executors.newSingleThreadScheduledExecutor { task -> Thread(task, "CodeWideDiagnosticUpload").apply { isDaemon = true } }
  private val client = OkHttpClient.Builder().connectTimeout(15, TimeUnit.SECONDS).readTimeout(30, TimeUnit.SECONDS).writeTimeout(30, TimeUnit.SECONDS).build()
  private var scheduled: ScheduledFuture<*>? = null
  @Volatile private var closed = false
  private data class CachedCredential(val saved: StoredNativeSession, val minted: MintedSessionCredential)
  private val authorization = mutableMapOf<String, CachedCredential>()
  private var historicalLogsCaptured = false

  @Synchronized fun start() {
    NativeDiagnosticRuntime.setWake(::wake)
    wake()
  }

  @Synchronized private fun wake() {
    if (closed) return
    if (scheduled?.isDone == false && scheduled!!.getDelay(TimeUnit.MILLISECONDS) <= 0) return
    scheduled?.cancel(false)
    scheduled = executor.schedule(::drain, 0, TimeUnit.MILLISECONDS)
  }

  private fun drain() {
    try {
      if (!historicalLogsCaptured) {
        // A failure to read logcat must never hold up already-persisted reports.
        runCatching { dev.codewide.app.diagnostics.HistoricalCrashLogs.capture() }
        historicalLogsCaptured = true
      }
      val sessions = credentials.list().filter { it.enabled && !it.revocationConfirmed }
      val first = sessions.firstOrNull() ?: return
      val journal = NativeDiagnosticRuntime.outbox()
      val unavailableTargets = mutableSetOf<String>()
      journal.pending().use { paths ->
        for (path in paths) {
          if (closed) return
          val file = path.toFile()
          // A malformed retained file must not prevent delivery of other reports.
          val target = runCatching { journal.target(file, first.id) }.getOrNull() ?: continue
          if (target in unavailableTargets) continue
          val saved = sessions.firstOrNull { it.id == target } ?: continue
          try {
            if (!upload(file, saved, journal)) unavailableTargets.add(target)
          } catch (_: Exception) {
            unavailableTargets.add(target)
          }
        }
      }
    } catch (_: Exception) {
      // No loss acknowledgement and no report data in transport-failure logging.
    } finally {
      synchronized(this) {
        if (!closed) scheduled = executor.schedule(::drain, 30, TimeUnit.SECONDS)
      }
    }
  }

  /** False means the target is unavailable; a rejected individual report stays queued without blocking others. */
  private fun upload(file: File, saved: StoredNativeSession, journal: DiagnosticJournal): Boolean {
    // Each attempt resolves current credentials. A cached revoked session cannot authorize a queued report.
    val minted = credential(saved)
    val pinned = InnerTlsTransport.client(client, saved, "diagnostic")
    val endpoint = URI(InnerTlsTransport.url(saved, saved.endpoint))
    val origin = URI("https", endpoint.rawAuthority, null, null, null).toString()
    val request = Request.Builder().url("$origin/v1/diagnostics/reports/${file.nameWithoutExtension}")
      .header("Authorization", "Bearer ${minted.token}")
      .post(file.asRequestBody("application/json; charset=utf-8".toMediaType())).build()
    return pinned.newCall(request).execute().use { response ->
      if (!response.isSuccessful) {
        if (response.code == 401) authorization.remove(saved.id)
        response.code == 400 || response.code == 409
      } else {
        val receipt = JSONObject(response.body?.string().orEmpty())
        if (!journal.acknowledge(file, receipt)) throw IOException("Diagnostic receipt did not match the queued report")
        true
      }
    }
  }

  private fun mint(saved: StoredNativeSession): MintedSessionCredential {
    val ready = CountDownLatch(1)
    var result: Result<MintedSessionCredential>? = null
    SessionCredentialClient.mint(client, saved) { value -> result = value; ready.countDown() }
    check(ready.await(30, TimeUnit.SECONDS)) { "Diagnostic authentication timed out" }
    return checkNotNull(result).getOrThrow()
  }

  private fun credential(saved: StoredNativeSession): MintedSessionCredential {
    val cached = authorization[saved.id]
    if (cached != null && cached.saved == saved && cached.minted.expiresAt > System.currentTimeMillis() + 30_000) return cached.minted
    val minted = mint(saved)
    authorization[saved.id] = CachedCredential(saved, minted)
    return minted
  }

  @Synchronized override fun close() {
    closed = true
    NativeDiagnosticRuntime.setWake(null)
    scheduled?.cancel(false)
    client.dispatcher.cancelAll()
    executor.shutdownNow()
    client.connectionPool.evictAll()
    client.dispatcher.executorService.shutdown()
  }
}
