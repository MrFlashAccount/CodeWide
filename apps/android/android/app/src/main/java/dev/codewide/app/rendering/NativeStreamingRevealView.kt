package dev.codewide.app.rendering

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Color
import android.os.SystemClock
import android.text.Spannable
import android.text.SpannableString
import android.text.Spanned
import android.text.TextPaint
import android.text.style.CharacterStyle
import android.text.style.UpdateAppearance
import android.view.Choreographer
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import android.widget.TextView
import com.facebook.react.views.text.ReactTextView
import com.facebook.react.views.view.ReactViewGroup
import java.util.IdentityHashMap

/** Decorates native glyph paint only: React and Yoga retain text, spans and line layout. */
class NativeStreamingRevealView(context: Context) : ReactViewGroup(context), ViewTreeObserver.OnPreDrawListener {
  private var streamKey = ""
  private var reduceMotion = false
  private var animateNew = true
  private val session = StreamingRevealSession()
  private var frameTime = 0L
  private var frameScheduled = false
  private val targets = IdentityHashMap<ReactTextView, Target>()
  private val seen = mutableSetOf<ReactTextView>()
  private val frameCallback = Choreographer.FrameCallback {
    frameScheduled = false
    frameTime = SystemClock.uptimeMillis()
    for ((view, target) in targets) {
      target.spans.removeAll { span ->
        if (!span.glyph.finished(frameTime)) false else {
          target.text?.removeSpan(span)
          true
        }
      }
      target.state.glyphs.removeAll { it.finished(frameTime) }
      target.invalidatePaint()
      view.invalidate()
    }
    scheduleFrame()
  }

  fun setStreamKey(value: String?) {
    val next = value ?: ""
    if (next == streamKey) return
    releaseTargets()
    streamKey = next
    invalidate()
  }

  fun setReduceMotion(value: Boolean) {
    reduceMotion = value
    if (value) releaseTargets()
    invalidate()
  }

  fun setAnimateNew(value: Boolean) {
    animateNew = value
    if (!value) releaseTargets()
    invalidate()
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    viewTreeObserver.addOnPreDrawListener(this)
  }

  override fun onDetachedFromWindow() {
    viewTreeObserver.removeOnPreDrawListener(this)
    releaseTargets()
    super.onDetachedFromWindow()
  }

  override fun onWindowVisibilityChanged(visibility: Int) {
    super.onWindowVisibilityChanged(visibility)
    if (visibility != View.VISIBLE) releaseTargets()
  }

  override fun onVisibilityAggregated(isVisible: Boolean) {
    super.onVisibilityAggregated(isVisible)
    if (!isVisible) releaseTargets()
  }

  override fun onPreDraw(): Boolean {
    if (!isShown || windowVisibility != View.VISIBLE) return true
    frameTime = SystemClock.uptimeMillis()
    seen.clear()
    visit(this, "")
    if (targets.values.any { it.state.source.isNotEmpty() }) session.didPresentText()
    val iterator = targets.entries.iterator()
    while (iterator.hasNext()) {
      val entry = iterator.next()
      if (entry.key !in seen) {
        entry.value.clear()
        iterator.remove()
      }
    }
    scheduleFrame()
    return true
  }

  fun release() { releaseTargets() }

  private fun visit(group: ViewGroup, path: String) {
    for (index in 0 until group.childCount) {
      val child = group.getChildAt(index)
      if (child.visibility != View.VISIBLE) continue
      // Atomic rows and media own the reveal of their complete subtree.
      if (child is NativeRevealView) continue
      val childPath = "$path/$index"
      if (child is ReactTextView) bind(child, childPath)
      else if (child is ViewGroup) visit(child, childPath)
    }
  }

  private fun bind(view: ReactTextView, path: String) {
    seen.add(view)
    val key = "$streamKey:$path"
    val current = view.text
    val previous = targets[view]
    if (previous != null && previous.key != key) {
      previous.clear()
      targets.remove(view)
    }
    val target = targets.getOrPut(view) {
      Target(key, session.createState(current.length, animateNew))
    }
    val animate = animateNew && !reduceMotion && ValueAnimator.areAnimatorsEnabled()
    if (!animate) target.clear()
    if (current === target.text && current.length == target.state.source.length) return
    target.clearSpans()
    target.state.update(current.toString(), frameTime, animate)
    if (target.state.glyphs.isEmpty()) {
      target.text = current as? Spannable
      return
    }
    // Fabric can share its Spanned value with other mounts. Own only this
    // TextView's decoration copy; preserve links, styles and selection spans.
    val local = SpannableString(current)
    view.setText(local, TextView.BufferType.SPANNABLE)
    val text = view.text as? Spannable ?: return
    target.text = text
    for (glyph in target.state.glyphs) {
      val span = WaveSpan(glyph)
      text.setSpan(span, glyph.start, glyph.end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
      target.spans.add(span)
    }
  }

  private fun scheduleFrame() {
    if (frameScheduled || !isAttachedToWindow || !isShown || targets.values.none { it.spans.isNotEmpty() }) return
    frameScheduled = true
    Choreographer.getInstance().postFrameCallback(frameCallback)
  }

  private fun releaseTargets() {
    Choreographer.getInstance().removeFrameCallback(frameCallback)
    frameScheduled = false
    for (target in targets.values) {
      target.clear()
    }
    targets.clear()
    session.reset()
  }

  private inner class WaveSpan(val glyph: RevealGlyph) : CharacterStyle(), UpdateAppearance {
    override fun updateDrawState(paint: TextPaint) {
      val opacity = glyph.opacity(frameTime)
      val highlight = glyph.highlight(frameTime)
      val color = paint.color
      fun channel(value: Int): Int = (value + (255 - value) * highlight).toInt()
      paint.color = Color.argb((Color.alpha(color) * opacity).toInt(), channel(Color.red(color)), channel(Color.green(color)), channel(Color.blue(color)))
    }
  }

  private inner class Target(val key: String, val state: StreamingRevealState) {
    var text: Spannable? = null
    val spans = mutableListOf<WaveSpan>()
    private val paintRevision = object : UpdateAppearance {}
    fun invalidatePaint() {
      val first = spans.firstOrNull()
      if (first == null) {
        text?.removeSpan(paintRevision)
        return
      }
      val last = spans.last()
      // Selectable TextViews cache text RenderNodes by line block. invalidate()
      // alone replays that cached paint. A paint-only span change invalidates
      // the affected text display lists without changing text or font metrics.
      text?.setSpan(paintRevision, first.glyph.start, last.glyph.end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    }
    fun clearSpans() {
      text?.removeSpan(paintRevision)
      for (span in spans) text?.removeSpan(span)
      spans.clear()
    }
    fun clear() { clearSpans(); state.finish() }
  }
}
