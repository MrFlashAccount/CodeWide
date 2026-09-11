package dev.codewide.app.performance

import android.app.ActivityManager
import android.app.Application
import android.content.Context
import android.os.Build
import android.os.Debug
import android.os.Process
import android.os.SystemClock
import java.io.BufferedReader
import java.io.File
import java.io.Reader
import org.json.JSONArray
import org.json.JSONObject

private const val KIBIBYTE = 1_024L
private val MAPPING_HEADER = Regex("^[0-9a-fA-F]+-[0-9a-fA-F]+\\s+\\S+\\s+\\S+\\s+\\S+\\s+\\S+(?:\\s+(.*))?$")
private val MEMORY_METRIC = Regex("^([A-Za-z_]+):\\s+(\\d+)\\s+kB$")
private val EXPORTED_SMAPS_METRICS = setOf(
  "Size",
  "Rss",
  "Pss",
  "Shared_Clean",
  "Shared_Dirty",
  "Private_Clean",
  "Private_Dirty",
  "Swap",
  "SwapPss",
  "Anonymous",
  "LazyFree",
  "Locked",
)

internal data class MemoryMappingSummary(
  val category: String,
  var mappingCount: Int = 0,
  val metricsBytes: MutableMap<String, Long> = linkedMapOf(),
)

internal object ProcMemoryBreakdown {
  fun readKeyValueFile(file: File): Map<String, Long> =
    file.bufferedReader().use(::readKeyValueMetrics)

  fun readKeyValueMetrics(reader: Reader): Map<String, Long> {
    val result = linkedMapOf<String, Long>()
    reader.buffered().forEachLine { line ->
      val match = MEMORY_METRIC.matchEntire(line.trim()) ?: return@forEachLine
      result[match.groupValues[1]] = match.groupValues[2].toLong() * KIBIBYTE
    }
    return result
  }

  fun readSmaps(file: File): List<MemoryMappingSummary> =
    file.bufferedReader().use(::readSmaps)

  fun readSmaps(reader: Reader): List<MemoryMappingSummary> {
    val summaries = linkedMapOf<String, MemoryMappingSummary>()
    var current: MemoryMappingSummary? = null
    val buffered = if (reader is BufferedReader) reader else reader.buffered()
    while (true) {
      val line = buffered.readLine() ?: break
      val header = MAPPING_HEADER.matchEntire(line)
      if (header !== null) {
        val category = memoryMappingCategory(header.groupValues.getOrNull(1).orEmpty())
        current = summaries.getOrPut(category) { MemoryMappingSummary(category) }
        current.mappingCount += 1
        continue
      }
      val metric = MEMORY_METRIC.matchEntire(line.trim()) ?: continue
      val key = metric.groupValues[1]
      if (key !in EXPORTED_SMAPS_METRICS) continue
      val summary = current ?: continue
      summary.metricsBytes[key] = (summary.metricsBytes[key] ?: 0L) +
        metric.groupValues[2].toLong() * KIBIBYTE
    }
    return summaries.values.sortedByDescending { it.metricsBytes["Pss"] ?: 0L }
  }

  fun memoryMappingCategory(path: String): String {
    val value = path.lowercase()
    return when {
      value.contains("webview") || value.contains("chromium") || value.contains("trichrome") ||
        value.contains("monochrome") -> "webview-chromium"
      value.contains("kgsl") || value.contains("dmabuf") || value.contains("gralloc") ||
        value.contains("/dev/dri") -> "graphics-device"
      value.startsWith("[anon:dalvik") || value.contains("jit-cache") ||
        value.contains("dalvik-") -> "dalvik-art"
      value == "[heap]" || value.contains("libc_malloc") || value.contains("scudo") -> "native-heap"
      value.startsWith("[stack") -> "thread-stacks"
      value.contains("/dev/ashmem") || value.contains("/memfd:") -> "shared-memory"
      value.endsWith(".db") || value.endsWith(".db-wal") || value.endsWith(".db-shm") ||
        value.contains("sqlite") -> "database-mappings"
      value.endsWith(".so") -> "native-libraries"
      value.endsWith(".apk") || value.endsWith(".dex") || value.endsWith(".oat") ||
        value.endsWith(".vdex") || value.endsWith(".art") -> "runtime-code"
      value.contains("/fonts/") || value.endsWith(".ttf") || value.endsWith(".otf") -> "fonts"
      value.isEmpty() || value.startsWith("[anon:") -> "other-anonymous"
      value.startsWith("/dev/") -> "other-device"
      value.startsWith("/") -> "other-file"
      else -> "other-anonymous"
    }
  }
}

internal class MemoryInvestigationReport(
  private val context: Context,
) {
  fun capture(): String {
    val errors = JSONArray()
    val memory = Debug.MemoryInfo()
    Debug.getMemoryInfo(memory)
    val runtime = Runtime.getRuntime()
    val activityManager = context.getSystemService(ActivityManager::class.java)
    val systemMemory = ActivityManager.MemoryInfo().also(activityManager::getMemoryInfo)
    val packageInfo = context.packageManager.getPackageInfo(context.packageName, 0)

    return JSONObject().apply {
      put("version", 1)
      put("collectedAtMs", System.currentTimeMillis())
      put("build", JSONObject().apply {
        put("versionName", packageInfo.versionName)
        put("versionCode", packageInfo.longVersionCode)
        put("sdkInt", Build.VERSION.SDK_INT)
        put("manufacturer", Build.MANUFACTURER)
        put("model", Build.MODEL)
      })
      put("process", JSONObject().apply {
        put("pid", Process.myPid())
        put("uid", Process.myUid())
        put("name", Application.getProcessName())
        put("uptimeMs", SystemClock.elapsedRealtime() - Process.getStartElapsedRealtime())
      })
      put("appHeap", JSONObject().apply {
        put("javaUsedBytes", runtime.totalMemory() - runtime.freeMemory())
        put("javaCommittedBytes", runtime.totalMemory())
        put("javaLimitBytes", runtime.maxMemory())
        put("nativeAllocatedBytes", Debug.getNativeHeapAllocatedSize())
        put("nativeCommittedBytes", Debug.getNativeHeapSize())
        put("nativeFreeBytes", Debug.getNativeHeapFreeSize())
        put("artRuntimeStats", JSONObject(Debug.getRuntimeStats().toSortedMap()))
      })
      put("processMemory", JSONObject().apply {
        put("totalPssBytes", memory.totalPss.toLong() * KIBIBYTE)
        put("totalRssBytes", memoryStatBytes(memory, "summary.total-rss"))
        put("totalPrivateBytes", (memory.totalPrivateClean + memory.totalPrivateDirty).toLong() * KIBIBYTE)
        put("totalPrivateDirtyBytes", memory.totalPrivateDirty.toLong() * KIBIBYTE)
        put("totalSharedDirtyBytes", memory.totalSharedDirty.toLong() * KIBIBYTE)
        put("totalSwapPssBytes", memory.totalSwappablePss.toLong() * KIBIBYTE)
        put("statsBytes", memoryStatsJson(memory))
      })
      put("systemMemory", JSONObject().apply {
        put("totalBytes", systemMemory.totalMem)
        put("availableBytes", systemMemory.availMem)
        put("lowMemoryThresholdBytes", systemMemory.threshold)
        put("lowMemory", systemMemory.lowMemory)
        put("memoryClassBytes", activityManager.memoryClass.toLong() * 1_024L * 1_024L)
        put("largeMemoryClassBytes", activityManager.largeMemoryClass.toLong() * 1_024L * 1_024L)
        put("lowRamDevice", activityManager.isLowRamDevice)
      })
      put("procStatusBytes", captureKeyValueFile("/proc/self/status", errors))
      put("smapsRollupBytes", captureKeyValueFile("/proc/self/smaps_rollup", errors))
      put("smapsCategories", captureSmaps(errors))
      put("openFileDescriptors", File("/proc/self/fd").list()?.size ?: -1)
      put("threads", File("/proc/self/task").list()?.size ?: -1)
      put("errors", errors)
    }.toString(2)
  }

  private fun memoryStatsJson(memory: Debug.MemoryInfo): JSONObject = JSONObject().apply {
    memory.memoryStats.toSortedMap().forEach { (key, value) ->
      value.toLongOrNull()?.let { put(key, it * KIBIBYTE) }
    }
  }

  private fun captureKeyValueFile(path: String, errors: JSONArray): JSONObject = try {
    JSONObject(ProcMemoryBreakdown.readKeyValueFile(File(path)))
  } catch (cause: Throwable) {
    errors.put(JSONObject().put("source", path.substringAfterLast('/')).put("kind", cause.javaClass.simpleName))
    JSONObject()
  }

  private fun captureSmaps(errors: JSONArray): JSONArray = try {
    JSONArray().apply {
      ProcMemoryBreakdown.readSmaps(File("/proc/self/smaps")).forEach { summary ->
        put(JSONObject().apply {
          put("category", summary.category)
          put("mappingCount", summary.mappingCount)
          put("metricsBytes", JSONObject(summary.metricsBytes))
        })
      }
    }
  } catch (cause: Throwable) {
    errors.put(JSONObject().put("source", "smaps").put("kind", cause.javaClass.simpleName))
    JSONArray()
  }

  private fun memoryStatBytes(memory: Debug.MemoryInfo, key: String): Long =
    memory.getMemoryStat(key)?.toLongOrNull()?.times(KIBIBYTE) ?: 0L
}

/**
 * Small enough to run between reclamation stages. Unlike the full report this
 * reads only kernel rollups and never walks every mapping in /proc/self/smaps.
 */
internal object LightweightMemoryCheckpoint {
  fun capture(): String {
    val startedAtNanos = SystemClock.elapsedRealtimeNanos()
    val errors = JSONArray()
    val memory = Debug.MemoryInfo()
    Debug.getMemoryInfo(memory)
    val runtime = Runtime.getRuntime()
    val procStatus = captureMetrics("/proc/self/status", errors)
    val smapsRollup = captureMetrics("/proc/self/smaps_rollup", errors)
    val result = JSONObject().apply {
      put("version", 1)
      put("collectedAtMs", System.currentTimeMillis())
      put("uptimeMs", SystemClock.elapsedRealtime() - Process.getStartElapsedRealtime())
      put("javaUsedBytes", runtime.totalMemory() - runtime.freeMemory())
      put("javaCommittedBytes", runtime.totalMemory())
      put("nativeAllocatedBytes", Debug.getNativeHeapAllocatedSize())
      put("nativeCommittedBytes", Debug.getNativeHeapSize())
      put("nativeFreeBytes", Debug.getNativeHeapFreeSize())
      put("totalPssBytes", memory.totalPss.toLong() * KIBIBYTE)
      put("javaHeapPssBytes", memoryStatBytes(memory, "summary.java-heap"))
      put("nativeHeapPssBytes", memoryStatBytes(memory, "summary.native-heap"))
      put("graphicsPssBytes", memoryStatBytes(memory, "summary.graphics"))
      put("privateOtherPssBytes", memoryStatBytes(memory, "summary.private-other"))
      put("procRssBytes", procStatus["VmRSS"] ?: JSONObject.NULL)
      put("smapsPssBytes", smapsRollup["Pss"] ?: JSONObject.NULL)
      put("smapsRssBytes", smapsRollup["Rss"] ?: JSONObject.NULL)
      put("smapsSwapPssBytes", smapsRollup["SwapPss"] ?: JSONObject.NULL)
      putRuntimeStat("artAllocatedBytes", "art.gc.bytes-allocated")
      putRuntimeStat("artFreedBytes", "art.gc.bytes-freed")
      put("openFileDescriptors", File("/proc/self/fd").list()?.size ?: -1)
      put("threads", File("/proc/self/task").list()?.size ?: -1)
      put("errors", errors)
    }
    result.put("captureDurationMs", (SystemClock.elapsedRealtimeNanos() - startedAtNanos) / 1_000_000.0)
    return result.toString()
  }

  private fun captureMetrics(path: String, errors: JSONArray): Map<String, Long> = try {
    ProcMemoryBreakdown.readKeyValueFile(File(path))
  } catch (cause: Throwable) {
    errors.put(JSONObject().put("source", path.substringAfterLast('/')).put("kind", cause.javaClass.simpleName))
    emptyMap()
  }

  private fun JSONObject.putRuntimeStat(outputKey: String, runtimeKey: String) {
    val value = Debug.getRuntimeStat(runtimeKey)?.toLongOrNull()
    put(outputKey, value ?: JSONObject.NULL)
  }

  private fun memoryStatBytes(memory: Debug.MemoryInfo, key: String): Long =
    memory.getMemoryStat(key)?.toLongOrNull()?.times(KIBIBYTE) ?: 0L
}
