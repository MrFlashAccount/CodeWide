package dev.codewide.app.remote

import android.app.ActivityManager
import android.app.ApplicationExitInfo
import android.content.Context

internal data class NativeProcessExitRecord(
  val timestampUnixMs: Long,
  val reason: Int,
  val status: Int,
  val importance: Int,
  val pssKb: Long,
  val rssKb: Long,
  val mainProcess: Boolean,
  val traceAvailable: Boolean,
)

internal data class NativeProcessExitTelemetryBatch(
  val metrics: List<NativeTelemetryMetric>,
  val checkpointTimestampUnixMs: Long,
)

internal sealed interface NativeProcessExitSelection {
  data class EstablishBaseline(val checkpointTimestampUnixMs: Long) : NativeProcessExitSelection
  data class Report(
    val records: List<NativeProcessExitRecord>,
    val checkpointTimestampUnixMs: Long,
  ) : NativeProcessExitSelection
  data object None : NativeProcessExitSelection
}

internal fun selectNativeProcessExits(
  records: List<NativeProcessExitRecord>,
  checkpointTimestampUnixMs: Long?,
  nowUnixMs: Long,
): NativeProcessExitSelection {
  val threshold = checkpointTimestampUnixMs ?: Long.MIN_VALUE
  val unreported = buildList {
    records.forEach { record ->
      if (record.timestampUnixMs > threshold) add(record)
    }
  }
  if (unreported.isEmpty()) {
    return if (checkpointTimestampUnixMs == null) {
      NativeProcessExitSelection.EstablishBaseline(nowUnixMs)
    } else {
      NativeProcessExitSelection.None
    }
  }
  return NativeProcessExitSelection.Report(
    records = unreported,
    checkpointTimestampUnixMs = unreported.maxOf(NativeProcessExitRecord::timestampUnixMs),
  )
}

internal fun NativeProcessExitRecord.toTelemetryMetric(nowUnixMs: Long): NativeTelemetryMetric =
  NativeTelemetryMetric(
    name = "app.previous_process_exit",
    values = mapOf(
      "exitTimestampUnixMs" to timestampUnixMs,
      "ageMs" to (nowUnixMs - timestampUnixMs).coerceAtLeast(0L),
      "status" to status,
      "importance" to importance,
      "pssKb" to pssKb,
      "rssKb" to rssKb,
      "mainProcess" to if (mainProcess) 1 else 0,
      "traceAvailable" to if (traceAvailable) 1 else 0,
    ),
    tags = mapOf("reason" to processExitReasonName(reason)),
  )

internal fun processExitReasonName(reason: Int): String = when (reason) {
  ApplicationExitInfo.REASON_ANR -> "anr"
  ApplicationExitInfo.REASON_CRASH -> "crash"
  ApplicationExitInfo.REASON_CRASH_NATIVE -> "crash_native"
  ApplicationExitInfo.REASON_DEPENDENCY_DIED -> "dependency_died"
  ApplicationExitInfo.REASON_EXCESSIVE_RESOURCE_USAGE -> "excessive_resource_usage"
  ApplicationExitInfo.REASON_EXIT_SELF -> "exit_self"
  ApplicationExitInfo.REASON_FREEZER -> "freezer"
  ApplicationExitInfo.REASON_INITIALIZATION_FAILURE -> "initialization_failure"
  ApplicationExitInfo.REASON_LOW_MEMORY -> "low_memory"
  ApplicationExitInfo.REASON_OTHER -> "other"
  ApplicationExitInfo.REASON_PACKAGE_STATE_CHANGE -> "package_state_change"
  ApplicationExitInfo.REASON_PACKAGE_UPDATED -> "package_updated"
  ApplicationExitInfo.REASON_PERMISSION_CHANGE -> "permission_change"
  ApplicationExitInfo.REASON_SIGNALED -> "signaled"
  ApplicationExitInfo.REASON_USER_REQUESTED -> "user_requested"
  ApplicationExitInfo.REASON_USER_STOPPED -> "user_stopped"
  else -> "unknown"
}

/** Reads Android's durable record of process deaths and advances it only after publication. */
internal class NativeProcessExitTelemetry(context: Context) {
  private val activityManager = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
  private val packageName = context.packageName
  private val preferences = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)

  fun collect(nowUnixMs: Long = System.currentTimeMillis()): NativeProcessExitTelemetryBatch? {
    val checkpoint = if (preferences.contains(CHECKPOINT_KEY)) {
      preferences.getLong(CHECKPOINT_KEY, 0L)
    } else {
      null
    }
    val records = buildList {
      activityManager.getHistoricalProcessExitReasons(packageName, 0, MAX_EXIT_RECORDS).forEach { exit ->
        add(
          NativeProcessExitRecord(
            timestampUnixMs = exit.timestamp,
            reason = exit.reason,
            status = exit.status,
            importance = exit.importance,
            pssKb = exit.pss,
            rssKb = exit.rss,
            mainProcess = exit.processName == packageName,
            traceAvailable = runCatching { exit.traceInputStream?.use { true } ?: false }.getOrDefault(false),
          ),
        )
      }
    }
    return when (val selection = selectNativeProcessExits(records, checkpoint, nowUnixMs)) {
      is NativeProcessExitSelection.EstablishBaseline -> {
        acknowledge(selection.checkpointTimestampUnixMs)
        null
      }
      is NativeProcessExitSelection.Report -> NativeProcessExitTelemetryBatch(
        metrics = selection.records.map { it.toTelemetryMetric(nowUnixMs) },
        checkpointTimestampUnixMs = selection.checkpointTimestampUnixMs,
      )
      NativeProcessExitSelection.None -> null
    }
  }

  fun acknowledge(checkpointTimestampUnixMs: Long): Boolean =
    preferences.edit().putLong(CHECKPOINT_KEY, checkpointTimestampUnixMs).commit()

  private companion object {
    const val PREFERENCES = "codewide_process_exit_telemetry"
    const val CHECKPOINT_KEY = "reported_through_timestamp_ms"
    const val MAX_EXIT_RECORDS = 16
  }
}
