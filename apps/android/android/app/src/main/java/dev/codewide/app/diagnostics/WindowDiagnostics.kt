package dev.codewide.app.diagnostics

import android.app.Activity
import android.os.Handler
import android.os.Looper
import android.view.ViewTreeObserver

/** Opt-in process session; observing never changes display metrics or requests layout. */
object WindowDiagnostics {
  private val journal = WindowDiagnosticJournal()
  private val handler = Handler(Looper.getMainLooper())
  private var activity: Activity? = null
  private var failedSamples = 0
  private var observer: ViewTreeObserver? = null
  private var layoutSamplePending = false
  private val layoutListener = ViewTreeObserver.OnGlobalLayoutListener {
    // Coalesce animated layouts; sample after RN's listeners have run.
    if (!layoutSamplePending) {
      layoutSamplePending = true
      handler.postDelayed(layoutSample, 100)
    }
  }
  private val layoutSample = Runnable {
    layoutSamplePending = false
    capture("layout")
  }

  fun attach(next: Activity) {
    checkMainThread()
    removeListener()
    activity = next
    if (journal.enabled) {
      installListener()
      capture("resume")
    }
  }

  fun detach(previous: Activity) {
    checkMainThread()
    if (activity !== previous) return
    capture("pause")
    removeListener()
    activity = null
  }

  fun setRecording(enabled: Boolean): Boolean {
    checkMainThread()
    if (journal.enabled == enabled) return enabled
    if (enabled) {
      journal.start()
      failedSamples = 0
      installListener()
      capture("start")
    } else {
      capture("stop")
      journal.stop()
      removeListener()
    }
    return journal.enabled
  }

  fun capture(reason: String) {
    checkMainThread()
    if (!journal.enabled) return
    val current = activity ?: return
    try {
      journal.record(System.currentTimeMillis(), reason, WindowGeometrySnapshot.read(current))
    } catch (_: Exception) {
      // Observation must not crash rendering. Export the failure count without user data.
      failedSamples += 1
    }
  }

  fun isRecording(): Boolean = journal.enabled

  fun report(): String {
    checkMainThread()
    capture("copy")
    return WindowDiagnosticReport.encode(journal, failedSamples)
  }

  private fun installListener() {
    val tree = activity?.window?.decorView?.viewTreeObserver ?: return
    if (!tree.isAlive) return
    observer = tree
    tree.addOnGlobalLayoutListener(layoutListener)
  }

  private fun removeListener() {
    observer?.takeIf { it.isAlive }?.removeOnGlobalLayoutListener(layoutListener)
    observer = null
    handler.removeCallbacks(layoutSample)
    layoutSamplePending = false
  }

  private fun checkMainThread() { check(Looper.myLooper() == Looper.getMainLooper()) }
}
