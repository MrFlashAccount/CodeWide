package dev.codewide.app.rendering

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Rect
import android.os.Trace
import android.os.SystemClock
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.widget.ScrollView
import androidx.core.widget.NestedScrollView
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.uimanager.PixelUtil
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp
import com.facebook.react.views.view.ReactViewGroup
import com.facebook.react.views.view.ReactViewManager
import kotlin.math.roundToInt

/** Retains the outgoing pixels across reflow until the incoming body can be revealed. */
class PaneSnapshotManager : ReactViewManager() {
  override fun getName() = "CodeWidePaneSnapshot"
  override fun createViewInstance(context: ThemedReactContext) = PaneSnapshotView(context)

  @ReactProp(name = "canvasColor", customType = "Color")
  fun setCanvasColor(view: ReactViewGroup, color: Int) {
    if (view is PaneSnapshotView) view.canvasColor = color
  }

  @ReactProp(name = "keepScrollEnd")
  fun setKeepScrollEnd(view: ReactViewGroup, enabled: Boolean) {
    if (view is PaneSnapshotView) view.keepScrollEnd = enabled
  }

  override fun receiveCommand(root: ReactViewGroup, commandId: String, args: ReadableArray?) {
    if (root is PaneSnapshotView) {
      when (commandId) {
        "capture" -> {
          root.capture(args != null && args.size() > 0 && args.getBoolean(0))
          return
        }
        "captureReflow" -> {
          val width = if (args != null && args.size() > 0) {
            PixelUtil.toPixelFromDIP(args.getDouble(0)).roundToInt()
          } else root.width
          root.captureReflow(width)
          return
        }
        "cancelReflow" -> {
          root.cancelReflow()
          return
        }
        "reveal" -> {
          root.reveal()
          return
        }
      }
    }
    super.receiveCommand(root, commandId, args)
  }

  override fun onDropViewInstance(view: ReactViewGroup) {
    if (view is PaneSnapshotView) view.clearSnapshot()
    super.onDropViewInstance(view)
  }
}

/** Reading content whose inner layout can settle after the enclosing pane has reached its width. */
internal interface PaneReflowContent {
  val displayedWidth: Int
  fun isReadyAt(width: Int): Boolean
}

class PaneSnapshotView(context: Context) : ReactViewGroup(context) {
  var canvasColor: Int = 0
  var keepScrollEnd = false
  private var pinnedScroll: ViewGroup? = null
  private val paint = Paint()
  private val area = Rect()
  private var leftEdge = 0
  private var topEdge = 0
  private var oldWidth = 0
  private var image: Bitmap? = null
  private var waitingForSettle = false
  internal var reflowContent: PaneReflowContent? = null
  private var revealedExplicitly = false
  private var firstReadyAt: Long? = null
  private var fadeStart = 0L
  private var fadeDuration = FADE_MS
  private var reflowTargetWidth = 0
  private var reflowDeadline = 0L
  private val expire = Runnable(::expireSnapshot)

  private fun expireSnapshot() {
    if (image != null && fadeStart == 0L && (waitingForSettle || revealedExplicitly) && isShown) {
      // A cancelled settle or an empty list must still hand its pixels back smoothly.
      waitingForSettle = false
      startFade("PaneSnapshot.revealFallback")
      invalidate()
      postDelayed(expire, fadeDuration)
    } else {
      clearSnapshot()
    }
  }

  fun captureReflow(targetWidth: Int = width) {
    val content = reflowContent ?: return
    if (targetWidth <= 0 || (image != null && reflowTargetWidth == targetWidth)) return
    if (image == null && kotlin.math.abs(content.displayedWidth - targetWidth) <= 1) return
    val deadline = SystemClock.uptimeMillis() + REFLOW_BUDGET_MS
    capture(true)
    if (image == null) return
    reflowTargetWidth = targetWidth
    reflowDeadline = deadline
    reveal()
  }

  fun cancelReflow() {
    if (reflowTargetWidth > 0) clearSnapshot()
  }

  fun capture(revealOnSettle: Boolean = false) {
    val child = getChildAt(0) ?: return
    if (findFocus()?.onCheckIsTextEditor() == true || !isShown || !isAttachedToWindow ||
      !getLocalVisibleRect(area) || child.width <= 0 || area.width().toLong() * area.height() > MAX_PIXELS
    ) {
      clearSnapshot()
      return
    }
    Trace.beginSection("PaneSnapshot.capture")
    try {
      captureVisible(child.width, revealOnSettle)
    } finally {
      Trace.endSection()
    }
  }

  private fun captureVisible(childWidth: Int, revealOnSettle: Boolean) {
    val captured = Bitmap.createBitmap(area.width(), area.height(), Bitmap.Config.ARGB_8888)
    captured.density = Bitmap.DENSITY_NONE
    captured.eraseColor(canvasColor)
    val canvas = Canvas(captured)
    canvas.translate(-area.left.toFloat(), -area.top.toFloat())
    // draw includes any outgoing layer already on screen when a transition is reversed.
    try {
      draw(canvas)
    } catch (_: IllegalArgumentException) {
      // A hardware-only bitmap in a child cannot be drawn into a software canvas.
      clearSnapshot()
      return
    } catch (_: IllegalStateException) {
      // Hardware-only drawing commands are unsupported on a bitmap canvas.
      clearSnapshot()
      return
    }
    clearSnapshot()
    // The PR overview contains one vertical reading ScrollView. Lists own their anchors.
    if (keepScrollEnd) {
      pinnedScroll = findReadingScroll(this)?.takeIf { it.scrollY > 0 && !it.canScrollVertically(1) }
    }
    waitingForSettle = revealOnSettle
    image = captured
    leftEdge = area.left
    topEdge = area.top
    oldWidth = childWidth
    fadeStart = 0L
    // An unchanged width, aborted navigation, or hidden pane must release the drawing too.
    postDelayed(expire, if (revealOnSettle) SETTLE_WATCHDOG_MS else EXPIRY_MS)
  }

  override fun dispatchDraw(canvas: Canvas) {
    val scroll = pinnedScroll
    if (scroll != null && scroll.isAttachedToWindow && getChildAt(0)?.width != oldWidth) {
      // The platform clamps to the shorter page. Follow its new end when the page grows back.
      scroll.scrollTo(scroll.scrollX, scroll.getChildAt(0)?.height ?: 0)
      pinnedScroll = null
    }
    val snapshot = image
    if (snapshot == null) {
      super.dispatchDraw(canvas)
      return
    }
    // The target width may have landed before the virtualizer has committed its row offsets.
    val awaitingRows = revealedExplicitly && fadeStart == 0L && awaitingReflow()
    if (waitingForSettle || awaitingRows) {
      // Layout and pre-draw anchor updates still run while the outgoing surface covers the list.
      if (Color.alpha(canvasColor) < 255) super.dispatchDraw(canvas)
      if (awaitingRows) postInvalidateOnAnimation()
      paint.alpha = 255
      canvas.drawColor(canvasColor)
      canvas.drawBitmap(snapshot, leftEdge.toFloat(), topEdge.toFloat(), paint)
      return
    }
    super.dispatchDraw(canvas)
    if (fadeStart == 0L) {
      if (!revealedExplicitly && getChildAt(0)?.width == oldWidth) return
      startFade(if (revealedExplicitly) "PaneSnapshot.revealSettled" else "PaneSnapshot.reveal")
    }
    val elapsed = SystemClock.uptimeMillis() - fadeStart
    if (elapsed >= fadeDuration) {
      if (reflowTargetWidth > 0) {
        Trace.beginSection("PaneSnapshot.reflowComplete")
        Trace.endSection()
      }
      clearSnapshot()
      return
    }
    paint.alpha = ((fadeDuration - elapsed) * 255L / fadeDuration).toInt()
    canvas.drawBitmap(snapshot, leftEdge.toFloat(), topEdge.toFloat(), paint)
    postInvalidateOnAnimation()
  }

  private fun startFade(section: String) {
    Trace.beginSection(section)
    val now = SystemClock.uptimeMillis()
    fadeStart = if (reflowTargetWidth > 0) firstReadyAt ?: now else now
    fadeDuration = if (reflowTargetWidth > 0) {
      (reflowDeadline - fadeStart).coerceIn(MIN_REFLOW_FADE_MS, FADE_MS)
    } else FADE_MS
    // The first ready frame already showed the old pixels at full opacity. On a slow
    // display keep one blended frame even when the second ready frame arrived late.
    fadeStart = maxOf(fadeStart, now - fadeDuration / 2)
    Trace.endSection()
  }

  private fun awaitingReflow(): Boolean {
    val content = reflowContent ?: return false
    val ready = content.isReadyAt(if (reflowTargetWidth > 0) reflowTargetWidth else width)
    if (!ready) firstReadyAt = null
    if (!ready || firstReadyAt != null) return !ready
    firstReadyAt = SystemClock.uptimeMillis()
    return true
  }

  fun reveal() {
    if (waitingForSettle) {
      waitingForSettle = false
      removeCallbacks(expire)
      revealedExplicitly = true
      postDelayed(expire, SETTLE_WATCHDOG_MS)
      invalidate()
    }
  }

  fun clearSnapshot() {
    reflowTargetWidth = 0
    reflowDeadline = 0L
    waitingForSettle = false
    revealedExplicitly = false
    firstReadyAt = null
    pinnedScroll = null
    removeCallbacks(expire)
    if (image != null) {
      image = null
      invalidate()
    }
  }

  override fun dispatchTouchEvent(event: MotionEvent): Boolean {
    if (event.actionMasked == MotionEvent.ACTION_DOWN) {
      if (image != null && fadeStart == 0L) clearSnapshot() else pinnedScroll = null
    }
    return super.dispatchTouchEvent(event)
  }

  private fun findReadingScroll(view: View): ViewGroup? {
    if (view is ScrollView) return view
    if (view is NestedScrollView) return view
    if (view is ViewGroup) {
      for (index in 0 until view.childCount) {
        findReadingScroll(view.getChildAt(index))?.let { return it }
      }
    }
    return null
  }

  override fun onDetachedFromWindow() {
    clearSnapshot()
    super.onDetachedFromWindow()
  }

  private companion object {
    const val MAX_PIXELS = 4_000_000L
    const val FADE_MS = 110L
    // Reserve time for input dispatch and presentation within a roughly 250 ms interaction.
    const val REFLOW_BUDGET_MS = 175L
    const val MIN_REFLOW_FADE_MS = 32L
    const val EXPIRY_MS = 600L
    // The preset spring and its final Fabric commit can outlast a passive width-change capture.
    const val SETTLE_WATCHDOG_MS = 1500L
  }
}
