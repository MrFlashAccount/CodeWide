package dev.codewide.app.performance

import android.os.Build
import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import android.view.WindowInsets

/** Samples geometry at draw time without walking rows, changing layout or requesting another frame. */
internal class TimelineViewObservation(
  private val view: ViewGroup,
  private val record: (TimelineTraceEvent.Geometry) -> Unit,
  private val detached: () -> Unit,
) : View.OnAttachStateChangeListener {
  private var observer: ViewTreeObserver? = null
  private val drawListener = ViewTreeObserver.OnDrawListener { sample(TimelineGeometryPhase.DRAW) }

  init {
    view.addOnAttachStateChangeListener(this)
    if (view.isAttachedToWindow) onViewAttachedToWindow(view)
  }

  fun sample(phase: TimelineGeometryPhase) {
    val content = view.getChildAt(0)
    record(TimelineTraceEvent.Geometry(
      System.currentTimeMillis(), SystemClock.uptimeMillis(), view.id, phase,
      view.scrollY, content?.height ?: 0, view.height, (content as? ViewGroup)?.childCount ?: 0,
      view.isShown, view.alpha, content?.alpha ?: 0f,
      if (Build.VERSION.SDK_INT >= 30) view.rootWindowInsets?.getInsets(WindowInsets.Type.ime())?.bottom ?: -1 else -1,
    ))
  }

  override fun onViewAttachedToWindow(v: View) {
    if (observer != null) return
    observer = view.viewTreeObserver.also { it.addOnDrawListener(drawListener) }
    sample(TimelineGeometryPhase.ATTACH)
  }

  override fun onViewDetachedFromWindow(v: View) {
    sample(TimelineGeometryPhase.DETACH)
    close()
    detached()
  }

  fun close() {
    observer?.takeIf { it.isAlive }?.removeOnDrawListener(drawListener)
    observer = null
    view.removeOnAttachStateChangeListener(this)
  }
}
