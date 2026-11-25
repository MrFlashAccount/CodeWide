package dev.codewide.app.rendering

import android.content.Context
import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp
import com.facebook.react.uimanager.util.ReactFindViewUtil
import kotlin.math.abs
import kotlin.math.roundToInt

class WorkspaceResizeCheckpointManager : SimpleViewManager<WorkspaceResizeCheckpoint>() {
  override fun getName() = "CodeWideWorkspaceResizeCheckpoint"
  override fun createViewInstance(context: ThemedReactContext) = WorkspaceResizeCheckpoint(context)

  @ReactProp(name = "wideFrom")
  fun setWideFrom(view: WorkspaceResizeCheckpoint, value: Float) {
    view.wideFrom = value
  }

  @ReactProp(name = "target")
  fun setTarget(view: WorkspaceResizeCheckpoint, target: ReadableMap?) {
    view.target = target?.let {
      PaneResizeTarget(
        window = it.getDouble("window"),
        catalog = it.getDouble("catalog"),
        left = it.getDouble("left"),
        destination = it.getDouble("destination"),
      )
    }
  }
}

internal data class PaneResizeTarget(
  val window: Double,
  val catalog: Double,
  val left: Double,
  val destination: Double,
)

/** A non-drawing third child of the workspace frame, following the catalog and destination. */
class WorkspaceResizeCheckpoint(context: Context) : View(context), ViewTreeObserver.OnPreDrawListener {
  internal var target: PaneResizeTarget? = null
  internal var wideFrom = 0f
  private var observedRoot: View? = null
  private var pending: ViewTreeObserver? = null
  private var firstDeferredAt: Long? = null
  private var previousWide: Boolean? = null
  private val density get() = resources.displayMetrics.density
  private val resize = OnLayoutChangeListener { root, left, _, right, _, oldLeft, _, oldRight, _ ->
    val before = oldRight - oldLeft
    val after = right - left
    if (after <= 0 || wideFrom <= 0) return@OnLayoutChangeListener
    val wide = after >= wideFrom * density
    // Remember the previous class: the two displays can have different densities.
    val previous = previousWide ?: (before >= wideFrom * density)
    previousWide = wide
    if (before > 0 && previous != wide) {
      stopWaiting()
      pending = root.viewTreeObserver.also { it.addOnPreDrawListener(this) }
    }
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    observedRoot = rootView.also {
      previousWide = if (it.width > 0 && wideFrom > 0) it.width >= wideFrom * density else null
      it.addOnLayoutChangeListener(resize)
    }
  }

  override fun onDetachedFromWindow() {
    stopWaiting()
    observedRoot?.removeOnLayoutChangeListener(resize)
    observedRoot = null
    super.onDetachedFromWindow()
  }

  override fun onPreDraw(): Boolean {
    if (pending == null) return true
    val frame = parent as? ViewGroup
    if (frame != null && activeFrame(frame) && !hasLanded(frame)) {
      val now = SystemClock.uptimeMillis()
      val start = firstDeferredAt ?: now.also { firstDeferredAt = it }
      // A failed React render or an interrupted route must never prevent Android recovery UI.
      if (now - start < MAX_DEFER_MS) return false
    }
    stopWaiting()
    return true
  }

  private fun activeFrame(frame: ViewGroup): Boolean {
    if (!frame.isShown || frame.width == 0 || frame.height == 0) return false
    var ancestor: View? = frame
    while (ancestor != null) {
      if (ancestor.importantForAccessibility == IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS) return false
      ancestor = ancestor.parent as? View
    }
    return true
  }

  private fun hasLanded(frame: ViewGroup): Boolean {
    val expected = target ?: return true
    val catalog = frame.getChildAt(0) ?: return true
    val destination = frame.getChildAt(1) ?: return true
    val root = observedRoot ?: return true
    if (!matches(root.width, expected.window) || !matches(frame.width, expected.window)) return false
    if (!matches(catalog.width, expected.catalog) || !matches(destination.width, expected.destination)) return false
    if (expected.destination == 0.0) return true
    if (!matches(destination.left, expected.left)) return false
    if (destination.left >= frame.width) return true
    // react-native-screens commits the inner viewport size separately from its parent's box.
    val viewport = ReactFindViewUtil.findView(destination, "codewide-destination-viewport")
    return viewport == null || !viewport.isShown || abs(viewport.width - destination.width) <= 1
  }

  private fun matches(px: Int, dp: Double) = abs(px - (dp * density).roundToInt()) <= 1

  private fun stopWaiting() {
    pending?.takeIf { it.isAlive }?.removeOnPreDrawListener(this)
    pending = null
    firstDeferredAt = null
  }

  private companion object {
    // A display handoff with a large open transcript can take over a second on a busy device.
    const val MAX_DEFER_MS = 3_000L
  }
}
