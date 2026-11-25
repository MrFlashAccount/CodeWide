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

/** Native retry owner. Pending reports retry periodically; an empty outbox stays event-driven. */
internal class NativeDiagnosticUploader(private val credentials: NativeSessionCredentialsStore) : AutoCloseable {
  private val executor = Executors.newSingleThreadScheduledExecutor { task -> Thread(task, "CodeWideDiagnosticUpload").apply { isDaemon = true } }
  private val client = OkHttpClient.Builder().connectTimeout(15, TimeUnit.SECONDS).readTimeout(30, TimeUnit.SECONDS).writeTimeout(30, TimeUnit.SECONDS).build()
  private var scheduled: ScheduledFuture<*>? = null
  private var wakeRequested = false
  private var retryDelaySeconds = RETRY_INITIAL_DELAY_SECONDS
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
    retryDelaySeconds = RETRY_INITIAL_DELAY_SECONDS
    if (scheduled?.isDone == false && scheduled!!.getDelay(TimeUnit.MILLISECONDS) <= 0) {
      wakeRequested = true
      return
    }
    wakeRequested = false
    scheduled?.cancel(false)
    scheduled = executor.schedule(::drain, 0, TimeUnit.MILLISECONDS)
  }

  private fun drain() {
    var retryNeeded = false
    try {
      if (!historicalLogsCaptured) {
        // A failure to read logcat must never hold up already-persisted reports.
        runCatching { dev.codewide.app.diagnostics.HistoricalCrashLogs.capture() }
        historicalLogsCaptured = true
      }
      val journal = NativeDiagnosticRuntime.outbox()
      if (!journal.hasPending()) return
      retryNeeded = true
      val sessions = credentials.list().filter { it.enabled && !it.revocationConfirmed }
      val first = sessions.firstOrNull() ?: return
      val unavailableTargets = mutableSetOf<String>()
      for (file in journal.pending()) {
        if (closed) return
        // Rotation may have dropped a report since the snapshot; that is not a target failure.
        if (!file.isFile) continue
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
      retryNeeded = journal.hasPending()
    } catch (_: Exception) {
      // No loss acknowledgement and no report data in transport-failure logging.
      retryNeeded = runCatching { NativeDiagnosticRuntime.outbox().hasPending() }.getOrDefault(true)
    } finally {
      synchronized(this) {
        val requested = wakeRequested
        wakeRequested = false
        scheduled = if (!closed && (retryNeeded || requested)) {
          val delaySeconds = if (requested) 0L else retryDelaySeconds
          if (retryNeeded && !requested) {
            retryDelaySeconds = (retryDelaySeconds * 2).coerceAtMost(RETRY_MAX_DELAY_SECONDS)
          }
          executor.schedule(
            ::drain,
            delaySeconds,
            TimeUnit.SECONDS,
          )
        } else {
          retryDelaySeconds = RETRY_INITIAL_DELAY_SECONDS
          null
        }
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

  private companion object {
    const val RETRY_INITIAL_DELAY_SECONDS = 30L
    const val RETRY_MAX_DELAY_SECONDS = 15 * 60L
  }
}
