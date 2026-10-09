package dev.codewide.app.rendering

import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver

/** One renderer-owned decoration lifetime; release is safe to repeat. */
internal fun interface TextShimmerDecoration { fun release() }

/** UI-thread-owned, token-fenced decoration requests reconciled on mount/layout events. */
internal class TextShimmerRegistry(
  private val resolveView: (Int) -> View?,
  private val decorate: (View) -> TextShimmerDecoration?,
) {
  private class Registration(val token: String, private val onLayout: () -> Unit) :
    ViewTreeObserver.OnGlobalLayoutListener, View.OnAttachStateChangeListener {
    val views = mutableMapOf<View, TextShimmerDecoration>()
    private var root: View? = null
    private var observer: ViewTreeObserver? = null
    fun observeRoot(nextRoot: View?) {
      if (root === nextRoot) return
      stopObserving()
      root?.removeOnAttachStateChangeListener(this)
      root = nextRoot
      nextRoot?.addOnAttachStateChangeListener(this)
      nextRoot?.let(::observeLayout)
    }
    override fun onGlobalLayout() { onLayout() }
    override fun onViewAttachedToWindow(view: View) { observeLayout(view); onLayout() }
    override fun onViewDetachedFromWindow(view: View) { stopObserving() }
    private fun observeLayout(view: View) {
      stopObserving()
      observer = view.viewTreeObserver.also { it.addOnGlobalLayoutListener(this) }
    }
    private fun stopObserving() {
      observer?.takeIf { it.isAlive }?.removeOnGlobalLayoutListener(this)
      observer = null
    }
    fun release() { observeRoot(null); views.values.forEach { it.release() }; views.clear() }
  }
  private val requested = mutableMapOf<Int, Registration>()
  val hasRequests: Boolean get() = requested.isNotEmpty()

  fun attach(tag: Int, token: String) {
    if (requested[tag]?.token == token) return
    requested.remove(tag)?.release()
    val registration = Registration(token) {
      requested[tag]?.takeIf { it.token == token }?.let { reconcileView(tag, it) }
    }
    requested[tag] = registration
    reconcileView(tag, registration)
  }

  fun detach(tag: Int, token: String) {
    if (requested[tag]?.token != token) return
    requested.remove(tag)?.release()
  }

  fun reconcile() { requested.forEach { (tag, registration) -> reconcileView(tag, registration) } }
  fun release() { requested.values.forEach { it.release() }; requested.clear() }

  private fun reconcileView(tag: Int, registration: Registration) {
    val root = resolveView(tag)
    // Markdown may mount text children asynchronously without a React mount event.
    registration.observeRoot(root)
    val retained = mutableSetOf<View>()
    if (root != null) visit(root, registration, retained)
    val iterator = registration.views.iterator()
    while (iterator.hasNext()) {
      val entry = iterator.next()
      if (entry.key !in retained) { entry.value.release(); iterator.remove() }
    }
  }

  private fun visit(view: View, registration: Registration, retained: MutableSet<View>) {
    if (registration.views.containsKey(view)) { retained.add(view); return }
    val decoration = decorate(view)
    if (decoration != null) {
      retained.add(view)
      registration.views[view] = decoration
    } else if (view is ViewGroup) {
      for (index in 0 until view.childCount) visit(view.getChildAt(index), registration, retained)
    }
  }
}
