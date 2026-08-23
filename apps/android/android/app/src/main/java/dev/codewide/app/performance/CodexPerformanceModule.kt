package dev.codewide.app.performance

import android.app.Activity
import android.content.ContentValues
import android.net.TrafficStats
import android.os.Debug
import android.os.Environment
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.os.Process
import android.os.SystemClock
import android.provider.MediaStore
import android.view.FrameMetrics
import android.view.Window
import com.facebook.hermes.instrumentation.HermesSamplingProfiler
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.soloader.SoLoader
import java.util.ArrayDeque
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.zip.GZIPOutputStream
import kotlin.math.roundToLong

private const val EVENT_NAME = "CodexPerformanceSnapshot"
private const val SAMPLE_PERIOD_MS = 1_000L
private const val HISTORY_CAPACITY = 3_600
private const val MAX_HERMES_PROFILE_BYTES = 4 * 1_024 * 1_024L
private const val HEAP_SNAPSHOT_MIME_TYPE = "application/gzip"
private const val HEAP_SNAPSHOT_DIRECTORY = "CodeWide"

private data class HermesProfile(
  val sizeBytes: Long,
  val content: String?,
  val error: String?,
)

private data class PerformanceSample(
  val sequence: Long,
  val sampledAtMs: Long,
  val uptimeMs: Long,
  val cpuPercent: Double,
  val pssBytes: Long,
  val rssBytes: Long,
  val javaHeapBytes: Long,
  val javaHeapLimitBytes: Long,
  val nativeHeapBytes: Long,
  val javaHeapPssBytes: Long,
  val nativeHeapPssBytes: Long,
  val codePssBytes: Long,
  val stackPssBytes: Long,
  val graphicsPssBytes: Long,
  val privateOtherPssBytes: Long,
  val systemPssBytes: Long,
  val rxBytesPerSecond: Double,
  val txBytesPerSecond: Double,
  val rxSessionBytes: Long,
  val txSessionBytes: Long,
  val frame: FrameWindowSnapshot,
)

private data class ActiveNavigationTrace(
  val id: String,
  val startedAtElapsedMs: Long,
  val frames: FrameWindowAccumulator = FrameWindowAccumulator(),
  val hermesSamplingEnabled: Boolean,
)

/**
 * Android owns collection and the bounded history. React receives one compact
 * snapshot per second only while a diagnostic surface is subscribed.
 */
class CodexPerformanceModule(
  private val context: ReactApplicationContext,
) : ReactContextBaseJavaModule(context), LifecycleEventListener {
  private val preferences = context.getSharedPreferences("codex-performance", 0)
  private val collectorExecutor = Executors.newSingleThreadScheduledExecutor { runnable ->
    Thread(runnable, "codex-performance-sampler").apply { isDaemon = true }
  }
  private val heapSnapshotExecutor = Executors.newSingleThreadExecutor { runnable ->
    Thread(runnable, "codex-heap-snapshot-writer").apply { isDaemon = true }
  }
  private val heapSnapshotInFlight = AtomicBoolean(false)
  private val frameThread = HandlerThread("codex-frame-metrics").apply { start() }
  private val frameHandler = Handler(frameThread.looper)
  private val mainHandler = Handler(Looper.getMainLooper())
  private val frameAccumulator = FrameWindowAccumulator()
  private val navigationTraceLock = Any()
  private val history = ArrayDeque<PerformanceSample>(HISTORY_CAPACITY)
  private val historyLock = Any()
  @Volatile private var listenerCount = 0
  private var sampler: ScheduledFuture<*>? = null
  private var attachedWindow: Window? = null
  @Volatile private var enabled = preferences.getBoolean("enabled", false)
  private var sequence = 0L
  private var sessionStartedElapsedMs = 0L
  private var previousElapsedMs = 0L
  private var previousCpuMs = 0L
  private var previousRxBytes = TrafficStats.UNSUPPORTED.toLong()
  private var previousTxBytes = TrafficStats.UNSUPPORTED.toLong()
  private var sessionRxBaseline = TrafficStats.UNSUPPORTED.toLong()
  private var sessionTxBaseline = TrafficStats.UNSUPPORTED.toLong()
  private var displayIntervalNanos = 16_666_667L
  private var peakCpuPercent = 0.0
  private var peakPssBytes = 0L
  private var totalFrames = 0L
  private var totalJankFrames = 0L
  private var totalDroppedFrameEstimate = 0L
  @Volatile private var latest: PerformanceSample? = null
  private var activeNavigationTrace: ActiveNavigationTrace? = null

  private val frameListener = Window.OnFrameMetricsAvailableListener { _, metrics, _ ->
    val totalDuration = metrics.getMetric(FrameMetrics.TOTAL_DURATION)
    val deadline = metrics.getMetric(FrameMetrics.DEADLINE)
    frameAccumulator.record(totalDuration, deadline, displayIntervalNanos)
    synchronized(navigationTraceLock) {
      activeNavigationTrace?.frames?.record(totalDuration, deadline, displayIntervalNanos)
    }
  }

  init {
    context.addLifecycleEventListener(this)
    if (enabled) startCollector()
  }

  override fun getName(): String = "CodexPerformanceNative"

  @ReactMethod
  fun getPerformanceSnapshot(promise: Promise) {
    promise.resolve(snapshotMap())
  }

  @ReactMethod
  fun setPerformanceMonitoringEnabled(nextEnabled: Boolean, promise: Promise) {
    if (enabled != nextEnabled) {
      enabled = nextEnabled
      preferences.edit().putBoolean("enabled", nextEnabled).apply()
      if (nextEnabled) startCollector() else stopCollector()
    }
    promise.resolve(snapshotMap())
  }

  @ReactMethod
  fun beginNavigationTrace(traceId: String, promise: Promise) {
    if (!enabled || traceId.isBlank() || traceId.length > 256) {
      promise.resolve(false)
      return
    }
    synchronized(navigationTraceLock) {
      activeNavigationTrace?.takeIf { it.hermesSamplingEnabled }?.let { stopHermesSampling(null) }
      val hermesSamplingEnabled = runCatching {
        HermesSamplingProfiler.enable()
        true
      }.getOrDefault(false)
      activeNavigationTrace = ActiveNavigationTrace(
        id = traceId,
        startedAtElapsedMs = SystemClock.elapsedRealtime(),
        hermesSamplingEnabled = hermesSamplingEnabled,
      )
    }
    promise.resolve(true)
  }

  @ReactMethod
  fun endNavigationTrace(traceId: String, promise: Promise) {
    val trace = synchronized(navigationTraceLock) {
      activeNavigationTrace?.takeIf { it.id == traceId }?.also { activeNavigationTrace = null }
    }
    if (trace == null) {
      promise.resolve(null)
      return
    }
    val durationMs = (SystemClock.elapsedRealtime() - trace.startedAtElapsedMs).coerceAtLeast(1L)
    val hermesProfile = if (trace.hermesSamplingEnabled) captureHermesProfile(trace.id) else null
    promise.resolve(frameTraceMap(trace.frames.drain(durationMs), durationMs, hermesProfile))
  }

  @ReactMethod
  fun captureHermesHeapSnapshot(promise: Promise) {
    if (!heapSnapshotInFlight.compareAndSet(false, true)) {
      promise.reject("HEAP_SNAPSHOT_BUSY", "A Hermes heap snapshot is already running")
      return
    }
    val holder = context.javaScriptContextHolder
    if (holder == null) {
      heapSnapshotInFlight.set(false)
      promise.reject("HERMES_UNAVAILABLE", "Hermes runtime is unavailable")
      return
    }
    val collectedAt = System.currentTimeMillis()
    val captureDirectory = File(context.cacheDir, "heap-snapshots").apply { mkdirs() }
    val rawSnapshot = File(captureDirectory, "codewide-hermes-$collectedAt.heapsnapshot")
    try {
      ensureHeapSnapshotNativeLoaded()
      val scheduled = context.runOnJSQueueThread {
        try {
          synchronized(holder) {
            val runtimePointer = holder.get()
            check(runtimePointer != 0L) { "Hermes runtime is unavailable" }
            nativeCaptureHermesHeapSnapshot(runtimePointer, rawSnapshot.absolutePath, true)
          }
          heapSnapshotExecutor.execute {
            try {
              promise.resolve(publishHeapSnapshot(rawSnapshot, collectedAt))
            } catch (cause: Throwable) {
              promise.reject("HEAP_SNAPSHOT_SAVE_FAILED", cause.message, cause)
            } finally {
              runCatching { rawSnapshot.delete() }
              heapSnapshotInFlight.set(false)
            }
          }
        } catch (cause: Throwable) {
          runCatching { rawSnapshot.delete() }
          heapSnapshotInFlight.set(false)
          promise.reject("HEAP_SNAPSHOT_FAILED", cause.message, cause)
        }
      }
      if (!scheduled) throw IllegalStateException("Hermes runtime queue is unavailable")
    } catch (cause: Throwable) {
      runCatching { rawSnapshot.delete() }
      heapSnapshotInFlight.set(false)
      promise.reject("HEAP_SNAPSHOT_FAILED", cause.message, cause)
    }
  }

  @ReactMethod
  fun addListener(eventName: String) {
    if (eventName != EVENT_NAME) return
    listenerCount += 1
    emitSnapshot()
  }

  @ReactMethod
  fun removeListeners(count: Int) {
    listenerCount = (listenerCount - count).coerceAtLeast(0)
  }

  override fun onHostResume() {
    if (enabled) attachWindow(context.currentActivity)
  }

  override fun onHostPause() {
    detachWindow()
  }

  override fun onHostDestroy() {
    detachWindow()
  }

  override fun invalidate() {
    context.removeLifecycleEventListener(this)
    stopCollector(clearLatest = false)
    mainHandler.post {
      detachWindow()
      frameThread.quitSafely()
    }
    collectorExecutor.shutdownNow()
    heapSnapshotExecutor.shutdownNow()
    super.invalidate()
  }

  @Synchronized
  private fun ensureHeapSnapshotNativeLoaded() {
    if (heapSnapshotNativeLoaded) return
    SoLoader.loadLibrary("codewide_performance")
    heapSnapshotNativeLoaded = true
  }

  private fun publishHeapSnapshot(rawSnapshot: File, collectedAt: Long): WritableMap {
    check(rawSnapshot.isFile && rawSnapshot.length() > 0L) { "Hermes produced an empty heap snapshot" }
    val displayName = "codewide-hermes-heap-$collectedAt.heapsnapshot.gz"
    val values = ContentValues().apply {
      put(MediaStore.MediaColumns.DISPLAY_NAME, displayName)
      put(MediaStore.MediaColumns.MIME_TYPE, HEAP_SNAPSHOT_MIME_TYPE)
      put(MediaStore.MediaColumns.RELATIVE_PATH, "${Environment.DIRECTORY_DOWNLOADS}/$HEAP_SNAPSHOT_DIRECTORY")
      put(MediaStore.MediaColumns.IS_PENDING, 1)
    }
    val resolver = context.contentResolver
    val uri = checkNotNull(resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)) {
      "Could not create the heap snapshot download"
    }
    try {
      val output = checkNotNull(resolver.openOutputStream(uri, "w")) { "Could not open the heap snapshot download" }
      output.buffered().use { buffered ->
        GZIPOutputStream(buffered).use { gzip ->
          rawSnapshot.inputStream().buffered().use { input -> input.copyTo(gzip) }
        }
      }
      resolver.update(uri, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null)
      val compressedBytes = resolver.openFileDescriptor(uri, "r")?.use { descriptor -> descriptor.statSize } ?: 0L
      return Arguments.createMap().apply {
        putString("uri", uri.toString())
        putString("name", displayName)
        putDouble("sizeBytes", compressedBytes.coerceAtLeast(0L).toDouble())
        putDouble("rawSizeBytes", rawSnapshot.length().toDouble())
        putDouble("collectedAtMs", collectedAt.toDouble())
        putString("location", "Downloads/$HEAP_SNAPSHOT_DIRECTORY")
      }
    } catch (cause: Throwable) {
      runCatching { resolver.delete(uri, null, null) }
      throw cause
    }
  }

  private external fun nativeCaptureHermesHeapSnapshot(
    runtimePointer: Long,
    destinationPath: String,
    collectGarbageFirst: Boolean,
  )

  @Synchronized
  private fun startCollector() {
    if (sampler?.isCancelled == false && sampler?.isDone == false) return
    val now = SystemClock.elapsedRealtime()
    sessionStartedElapsedMs = now
    previousElapsedMs = now
    previousCpuMs = Process.getElapsedCpuTime()
    val uid = Process.myUid()
    previousRxBytes = TrafficStats.getUidRxBytes(uid)
    previousTxBytes = TrafficStats.getUidTxBytes(uid)
    sessionRxBaseline = previousRxBytes
    sessionTxBaseline = previousTxBytes
    peakCpuPercent = 0.0
    peakPssBytes = 0L
    totalFrames = 0L
    totalJankFrames = 0L
    totalDroppedFrameEstimate = 0L
    synchronized(historyLock) { history.clear() }
    frameAccumulator.reset()
    mainHandler.post { if (enabled) attachWindow(context.currentActivity) }
    sampler = collectorExecutor.scheduleAtFixedRate(
      { runCatching { sample() } },
      SAMPLE_PERIOD_MS,
      SAMPLE_PERIOD_MS,
      TimeUnit.MILLISECONDS,
    )
  }

  @Synchronized
  private fun stopCollector(clearLatest: Boolean = true) {
    sampler?.cancel(false)
    sampler = null
    frameAccumulator.reset()
    synchronized(navigationTraceLock) {
      activeNavigationTrace?.takeIf { it.hermesSamplingEnabled }?.let { stopHermesSampling(null) }
      activeNavigationTrace = null
    }
    mainHandler.post { detachWindow() }
    if (clearLatest) latest = null
  }

  private fun attachWindow(activity: Activity?) {
    val window = activity?.window ?: return
    if (attachedWindow === window) return
    detachWindow()
    val refreshRate = activity.display?.refreshRate?.takeIf { it > 0f } ?: 60f
    displayIntervalNanos = (1_000_000_000.0 / refreshRate).roundToLong().coerceAtLeast(1L)
    window.addOnFrameMetricsAvailableListener(frameListener, frameHandler)
    attachedWindow = window
  }

  private fun detachWindow() {
    val window = attachedWindow ?: return
    runCatching { window.removeOnFrameMetricsAvailableListener(frameListener) }
    attachedWindow = null
  }

  @Synchronized
  private fun sample() {
    if (!enabled) return
    val elapsedMs = SystemClock.elapsedRealtime()
    val elapsedDeltaMs = (elapsedMs - previousElapsedMs).coerceAtLeast(1L)
    val cpuMs = Process.getElapsedCpuTime()
    val cpuPercent = ((cpuMs - previousCpuMs).coerceAtLeast(0L) * 100.0 / elapsedDeltaMs).coerceAtLeast(0.0)
    previousElapsedMs = elapsedMs
    previousCpuMs = cpuMs

    val memory = Debug.MemoryInfo()
    Debug.getMemoryInfo(memory)
    val pssBytes = memory.totalPss.toLong() * 1_024L
    val rssBytes = memory.getMemoryStat("summary.total-rss")?.toLongOrNull()?.times(1_024L) ?: pssBytes
    val runtime = Runtime.getRuntime()
    val javaHeapBytes = runtime.totalMemory() - runtime.freeMemory()
    val javaHeapLimitBytes = runtime.maxMemory()
    val nativeHeapBytes = Debug.getNativeHeapAllocatedSize()
    val javaHeapPssBytes = memoryStatBytes(memory, "summary.java-heap")
    val nativeHeapPssBytes = memoryStatBytes(memory, "summary.native-heap")
    val codePssBytes = memoryStatBytes(memory, "summary.code")
    val stackPssBytes = memoryStatBytes(memory, "summary.stack")
    val graphicsPssBytes = memoryStatBytes(memory, "summary.graphics")
    val privateOtherPssBytes = memoryStatBytes(memory, "summary.private-other")
    val systemPssBytes = memoryStatBytes(memory, "summary.system")

    val uid = Process.myUid()
    val rxBytes = TrafficStats.getUidRxBytes(uid)
    val txBytes = TrafficStats.getUidTxBytes(uid)
    val rxRate = byteRate(rxBytes, previousRxBytes, elapsedDeltaMs)
    val txRate = byteRate(txBytes, previousTxBytes, elapsedDeltaMs)
    previousRxBytes = rxBytes
    previousTxBytes = txBytes
    val frame = frameAccumulator.drain(elapsedDeltaMs)

    sequence += 1
    peakCpuPercent = maxOf(peakCpuPercent, cpuPercent)
    peakPssBytes = maxOf(peakPssBytes, pssBytes)
    totalFrames += frame.renderedFrames
    totalJankFrames += frame.jankFrames
    totalDroppedFrameEstimate += frame.droppedFrameEstimate
    val current = PerformanceSample(
      sequence = sequence,
      sampledAtMs = System.currentTimeMillis(),
      uptimeMs = elapsedMs - sessionStartedElapsedMs,
      cpuPercent = cpuPercent,
      pssBytes = pssBytes,
      rssBytes = rssBytes,
      javaHeapBytes = javaHeapBytes,
      javaHeapLimitBytes = javaHeapLimitBytes,
      nativeHeapBytes = nativeHeapBytes,
      javaHeapPssBytes = javaHeapPssBytes,
      nativeHeapPssBytes = nativeHeapPssBytes,
      codePssBytes = codePssBytes,
      stackPssBytes = stackPssBytes,
      graphicsPssBytes = graphicsPssBytes,
      privateOtherPssBytes = privateOtherPssBytes,
      systemPssBytes = systemPssBytes,
      rxBytesPerSecond = rxRate,
      txBytesPerSecond = txRate,
      rxSessionBytes = sessionBytes(rxBytes, sessionRxBaseline),
      txSessionBytes = sessionBytes(txBytes, sessionTxBaseline),
      frame = frame,
    )
    latest = current
    synchronized(historyLock) {
      if (history.size == HISTORY_CAPACITY) history.removeFirst()
      history.addLast(current)
    }
    emitSnapshot()
  }

  private fun byteRate(current: Long, previous: Long, elapsedMs: Long): Double {
    if (current == TrafficStats.UNSUPPORTED.toLong() || previous == TrafficStats.UNSUPPORTED.toLong()) return -1.0
    return (current - previous).coerceAtLeast(0L) * 1_000.0 / elapsedMs
  }

  private fun sessionBytes(current: Long, baseline: Long): Long {
    if (current == TrafficStats.UNSUPPORTED.toLong() || baseline == TrafficStats.UNSUPPORTED.toLong()) return -1L
    return (current - baseline).coerceAtLeast(0L)
  }

  private fun memoryStatBytes(memory: Debug.MemoryInfo, key: String): Long =
    memory.getMemoryStat(key)?.toLongOrNull()?.times(1_024L) ?: 0L

  private fun emitSnapshot() {
    if (listenerCount <= 0) return
    mainHandler.post {
      if (listenerCount <= 0) return@post
      runCatching {
        context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
          .emit(EVENT_NAME, snapshotMap())
      }
    }
  }

  @Synchronized
  private fun snapshotMap(): WritableMap = Arguments.createMap().apply {
    putBoolean("available", true)
    putBoolean("enabled", enabled)
    putInt("samplePeriodMs", SAMPLE_PERIOD_MS.toInt())
    putInt("historyCapacity", HISTORY_CAPACITY)
    val sample = latest
    putInt("historySamples", synchronized(historyLock) { history.size })
    putDouble("peakCpuPercent", peakCpuPercent)
    putDouble("peakPssBytes", peakPssBytes.toDouble())
    putDouble("totalFrames", totalFrames.toDouble())
    putDouble("totalJankFrames", totalJankFrames.toDouble())
    putDouble("totalDroppedFrameEstimate", totalDroppedFrameEstimate.toDouble())
    putDouble("sessionJankPercent", if (totalFrames == 0L) 0.0 else totalJankFrames * 100.0 / totalFrames)
    if (sample == null) {
      putNull("current")
    } else {
      putMap("current", sampleMap(sample))
    }
    putArray("recent", recentSamples())
  }

  private fun sampleMap(sample: PerformanceSample): WritableMap = Arguments.createMap().apply {
    putDouble("sequence", sample.sequence.toDouble())
    putDouble("sampledAtMs", sample.sampledAtMs.toDouble())
    putDouble("uptimeMs", sample.uptimeMs.toDouble())
    putDouble("cpuPercent", sample.cpuPercent)
    putDouble("pssBytes", sample.pssBytes.toDouble())
    putDouble("rssBytes", sample.rssBytes.toDouble())
    putDouble("javaHeapBytes", sample.javaHeapBytes.toDouble())
    putDouble("javaHeapLimitBytes", sample.javaHeapLimitBytes.toDouble())
    putDouble("nativeHeapBytes", sample.nativeHeapBytes.toDouble())
    putDouble("javaHeapPssBytes", sample.javaHeapPssBytes.toDouble())
    putDouble("nativeHeapPssBytes", sample.nativeHeapPssBytes.toDouble())
    putDouble("codePssBytes", sample.codePssBytes.toDouble())
    putDouble("stackPssBytes", sample.stackPssBytes.toDouble())
    putDouble("graphicsPssBytes", sample.graphicsPssBytes.toDouble())
    putDouble("privateOtherPssBytes", sample.privateOtherPssBytes.toDouble())
    putDouble("systemPssBytes", sample.systemPssBytes.toDouble())
    putDouble("rxBytesPerSecond", sample.rxBytesPerSecond)
    putDouble("txBytesPerSecond", sample.txBytesPerSecond)
    putDouble("rxSessionBytes", sample.rxSessionBytes.toDouble())
    putDouble("txSessionBytes", sample.txSessionBytes.toDouble())
    putInt("renderedFrames", sample.frame.renderedFrames)
    putDouble("renderedFps", sample.frame.renderedFps)
    putDouble("averageFrameMs", sample.frame.averageFrameMs)
    putDouble("p95FrameMs", sample.frame.p95FrameMs)
    putDouble("maxFrameMs", sample.frame.maxFrameMs)
    putInt("jankFrames", sample.frame.jankFrames)
    putDouble("jankPercent", sample.frame.jankPercent)
    putInt("droppedFrameEstimate", sample.frame.droppedFrameEstimate)
    putDouble("averageOverrunMs", sample.frame.averageOverrunMs)
  }

  private fun frameTraceMap(frame: FrameWindowSnapshot, durationMs: Long, hermesProfile: HermesProfile?): WritableMap = Arguments.createMap().apply {
    putDouble("durationMs", durationMs.toDouble())
    putInt("renderedFrames", frame.renderedFrames)
    putDouble("averageFrameMs", frame.averageFrameMs)
    putDouble("p95FrameMs", frame.p95FrameMs)
    putDouble("maxFrameMs", frame.maxFrameMs)
    putInt("jankFrames", frame.jankFrames)
    putInt("droppedFrameEstimate", frame.droppedFrameEstimate)
    if (hermesProfile == null) {
      putNull("hermesProfile")
    } else {
      putMap("hermesProfile", Arguments.createMap().apply {
        putString("format", "hermes-sampling-profile")
        putDouble("sizeBytes", hermesProfile.sizeBytes.toDouble())
        if (hermesProfile.content == null) putNull("content") else putString("content", hermesProfile.content)
        if (hermesProfile.error == null) putNull("error") else putString("error", hermesProfile.error)
      })
    }
  }

  private fun captureHermesProfile(traceId: String): HermesProfile {
    val directory = File(context.cacheDir, "navigation-profiles").apply { mkdirs() }
    val file = File(directory, traceId.replace(Regex("[^A-Za-z0-9._-]"), "_") + ".cpuprofile")
    return try {
      stopHermesSampling(file)
      val size = file.length()
      if (size > MAX_HERMES_PROFILE_BYTES) {
        HermesProfile(sizeBytes = size, content = null, error = "profile_too_large")
      } else {
        HermesProfile(sizeBytes = size, content = file.readText(), error = null)
      }
    } catch (cause: Throwable) {
      runCatching { HermesSamplingProfiler.disable() }
      HermesProfile(sizeBytes = file.takeIf { it.exists() }?.length() ?: 0L, content = null, error = cause.javaClass.simpleName)
    } finally {
      runCatching { file.delete() }
    }
  }

  private fun stopHermesSampling(destination: File?) {
    if (destination != null) HermesSamplingProfiler.dumpSampledTraceToFile(destination.absolutePath)
    HermesSamplingProfiler.disable()
  }

  private fun recentSamples(): WritableArray = Arguments.createArray().apply {
    val recent: List<PerformanceSample> = synchronized(historyLock) { history.toList().takeLast(60) }
    recent.forEach { sample ->
      pushMap(Arguments.createMap().apply {
        putDouble("sampledAtMs", sample.sampledAtMs.toDouble())
        putDouble("cpuPercent", sample.cpuPercent)
        putDouble("pssBytes", sample.pssBytes.toDouble())
        putDouble("renderedFps", sample.frame.renderedFps)
        putDouble("p95FrameMs", sample.frame.p95FrameMs)
        putDouble("jankPercent", sample.frame.jankPercent)
        putDouble("rxBytesPerSecond", sample.rxBytesPerSecond)
        putDouble("txBytesPerSecond", sample.txBytesPerSecond)
      })
    }
  }

  companion object {
    @Volatile private var heapSnapshotNativeLoaded = false
  }
}
