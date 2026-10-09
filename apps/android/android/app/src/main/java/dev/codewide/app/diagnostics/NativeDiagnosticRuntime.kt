package dev.codewide.app.diagnostics

import android.content.Context
import android.os.Process
import android.util.Log
import dev.codewide.app.BuildConfig
import java.io.File
import java.util.UUID
import org.json.JSONObject

/** Captures reports before a process can die. Upload lifetime belongs to the native connection service. */
object NativeDiagnosticRuntime {
  private var journal: DiagnosticJournal? = null
  private var wake: (() -> Unit)? = null
  private var handlingCrash = false
  private val secrets = mutableSetOf<String>()

  @Synchronized
  fun install(context: Context) {
    if (journal != null) return
    journal = DiagnosticJournal(File(context.noBackupFilesDir, "diagnostic-outbox"))
    runCatching { dev.codewide.app.remote.NativeSessionCredentialsStore(context).list() }
      .getOrDefault(emptyList()).forEach { secrets.add(it.token) }
    val previous = Thread.getDefaultUncaughtExceptionHandler()
    Thread.setDefaultUncaughtExceptionHandler { thread, error ->
      try {
        synchronized(this) {
          if (!handlingCrash) {
            handlingCrash = true
            append(
              JSONObject().put("source", "jvm").put("event", "android.uncaught_exception").put("level", "fatal")
                .put("occurredAtUnixMs", System.currentTimeMillis())
                .put("err", JSONObject().put("name", error.javaClass.name).put("message", error.message.orEmpty()).put("stack", error.stackTraceToString()))
                .put("fields", JSONObject().put("threadName", thread.name).put("pid", Process.myPid())),
            )
          }
        }
      } catch (_: Throwable) {
        // The original fatal exception must still reach Android's crash handler if storage itself failed.
      } finally {
        if (previous != null) previous.uncaughtException(thread, error)
        else { Process.killProcess(Process.myPid()); kotlin.system.exitProcess(10) }
      }
    }
  }

  @Synchronized
  internal fun outbox(): DiagnosticJournal = checkNotNull(journal) { "Diagnostic capture is not installed" }

  @Synchronized
  internal fun setWake(callback: (() -> Unit)?) { wake = callback }

  @Synchronized
  internal fun privateText(value: String): String = DiagnosticPrivacy.text(value, secrets)

  @Synchronized
  internal fun rememberCredential(value: String) { secrets.add(value) }

  /** The sync native bridge returns only after the entire report is committed to disk. */
  @Synchronized
  fun append(input: JSONObject): Boolean {
    val source = input.getString("source")
    require(source in setOf("javascript", "jvm", "process_exit", "logcat", "native_trace"))
    val level = input.getString("level")
    require(level in setOf("debug", "info", "warn", "error", "fatal"))
    val event = input.getString("event")
    require(event.matches(Regex("^[A-Za-z0-9._-]+$")))
    val err = input.optJSONObject("err")
    val report = JSONObject()
      .put("version", 1)
      .put("reportId", input.optString("reportId").takeIf { it.isNotBlank() } ?: UUID.randomUUID().toString())
      .put("occurredAtUnixMs", input.getLong("occurredAtUnixMs"))
      .put("appVersion", BuildConfig.VERSION_NAME)
      .put("source", source).put("event", event).put("level", level)
      .put("message", DiagnosticPrivacy.text(input.optString("message"), this.secrets))
      .put("err", err?.let { DiagnosticPrivacy.error(it, this.secrets) } ?: JSONObject.NULL)
      .put("fields", DiagnosticPrivacy.fields(input.getJSONObject("fields"), this.secrets))
    outbox().append(report)
    wake?.invoke()
    return true
  }

  internal fun recordCaptureFailure() {
    // Never log the failed report or a secondary exception that may itself contain private input.
    Log.e("CodeWideDiagnostics", "Diagnostic outbox write failed; report was not acknowledged")
  }
}
