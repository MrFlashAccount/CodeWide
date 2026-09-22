package dev.codewide.app.rendering

import android.os.Looper
import android.view.View
import android.view.ViewTreeObserver

/** Owns metric synchronization for one surface, including RN's later rotation/layout writes. */
internal class SurfaceDisplayMetrics {
  private var surface: View? = null
  private var observer: ViewTreeObserver? = null
  private val layoutListener = ViewTreeObserver.OnGlobalLayoutListener { synchronize() }
  private val attachmentListener = object : View.OnAttachStateChangeListener {
    override fun onViewAttachedToWindow(view: View) {
      synchronize()
      observe(view)
    }

    override fun onViewDetachedFromWindow(view: View) {
      removeObserver()
    }
  }

  fun bind(next: View?) {
    checkMainThread()
    if (surface === next) return
    dispose()
    surface = next
    if (next == null) return
    // onContentChanged runs after RN constructs the surface, before its first measure/layout.
    synchronize()
    next.addOnAttachStateChangeListener(attachmentListener)
    if (next.isAttachedToWindow) observe(next)
  }

  fun synchronize() {
    checkMainThread()
    val current = surface ?: return
    if (WindowDisplayMetrics.synchronize(current.context)) {
      // Only a changed snapshot requests layout: the next traversal must converge to a no-op.
      current.requestLayout()
    }
  }

  fun dispose() {
    checkMainThread()
    removeObserver()
    surface?.removeOnAttachStateChangeListener(attachmentListener)
    surface = null
  }

  private fun observe(view: View) {
    removeObserver()
    // Attachment callbacks run after ReactRootView.onAttachedToWindow registers RN's listener.
    // Matching Jitsi's ordering lets this repair the globals after RN's rotation handler.
    observer = view.viewTreeObserver.also { it.addOnGlobalLayoutListener(layoutListener) }
  }

  private fun removeObserver() {
    observer?.takeIf { it.isAlive }?.removeOnGlobalLayoutListener(layoutListener)
    observer = null
  }

  private fun checkMainThread() { check(Looper.myLooper() == Looper.getMainLooper()) }
}
