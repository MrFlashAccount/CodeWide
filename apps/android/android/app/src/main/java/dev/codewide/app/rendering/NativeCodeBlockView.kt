package dev.codewide.app.rendering

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.util.TypedValue
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.widget.NestedScrollView
import dev.codewide.app.BuildConfig
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.atomic.AtomicInteger

class NativeCodeBlockView(context: Context) : FrameLayout(context) {
  private val generation = AtomicInteger(0)
  private val mainHandler = Handler(Looper.getMainLooper())
  private val textView = TextView(context).apply {
    setTextColor(TEXT_COLOR)
    setTextSize(TypedValue.COMPLEX_UNIT_DIP, 11f)
    typeface = Typeface.MONOSPACE
    includeFontPadding = false
    setLineSpacing(dp(3f), 1f)
    // Copying is owned by the surrounding React Native card. A selectable
    // TextView consumes horizontal drags before HorizontalScrollView can pan,
    // which made long code and diff rows look permanently clipped.
    setTextIsSelectable(false)
    setHorizontallyScrolling(true)
    setPadding(dp(6f).toInt(), dp(4f).toInt(), dp(8f).toInt(), dp(4f).toInt())
    setBackgroundColor(Color.TRANSPARENT)
  }
  private val gutterView = TextView(context).apply {
    setTextColor(GUTTER_COLOR)
    setTextSize(TypedValue.COMPLEX_UNIT_DIP, 11f)
    typeface = Typeface.MONOSPACE
    includeFontPadding = false
    setLineSpacing(dp(3f), 1f)
    setHorizontallyScrolling(true)
    setPadding(dp(4f).toInt(), dp(4f).toInt(), dp(5f).toInt(), dp(4f).toInt())
    setBackgroundColor(GUTTER_BACKGROUND)
    visibility = View.GONE
  }
  private val horizontalScroll = HorizontalScrollView(context).apply {
    isFillViewport = true
    isHorizontalScrollBarEnabled = true
    overScrollMode = OVER_SCROLL_IF_CONTENT_SCROLLS
    isNestedScrollingEnabled = true
    addView(textView, LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT))
  }
  private val row = LinearLayout(context).apply {
    orientation = LinearLayout.HORIZONTAL
    addView(gutterView, LinearLayout.LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT))
    addView(horizontalScroll, LinearLayout.LayoutParams(0, LayoutParams.WRAP_CONTENT, 1f))
  }
  private val verticalScroll = NestedScrollView(context).apply {
    isFillViewport = false
    isNestedScrollingEnabled = true
    isVerticalScrollBarEnabled = true
    overScrollMode = OVER_SCROLL_IF_CONTENT_SCROLLS
    addView(row, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT))
  }

  private var code: String = ""
  private var language: String = "text"
  private var variant: String = "code"
  private var maxLines: Int = 0
  private var pendingTask: Future<*>? = null
  private var scheduledHighlight: Runnable? = null
  private var touchStartX = 0f
  private var touchStartY = 0f
  private val touchSlop = ViewConfiguration.get(context).scaledTouchSlop.toFloat()

  init {
    clipChildren = true
    clipToPadding = true
    setBackgroundColor(Color.TRANSPARENT)
    addView(verticalScroll, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    horizontalScroll.setOnTouchListener { view, event ->
      when (event.actionMasked) {
        MotionEvent.ACTION_DOWN -> {
          touchStartX = event.x
          touchStartY = event.y
          // LegendList otherwise steals the gesture before the horizontal
          // direction is known. Capture the stream first and hand it back as
          // soon as it is clearly vertical.
          view.parent?.requestDisallowInterceptTouchEvent(true)
        }
        MotionEvent.ACTION_MOVE -> {
          val deltaX = kotlin.math.abs(event.x - touchStartX)
          val deltaY = kotlin.math.abs(event.y - touchStartY)
          if (deltaX > touchSlop || deltaY > touchSlop) {
            view.parent?.requestDisallowInterceptTouchEvent(deltaX >= deltaY)
          }
        }
        MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> view.parent?.requestDisallowInterceptTouchEvent(false)
      }
      false
    }
  }

  fun setCode(value: String?) {
    code = value.orEmpty()
  }

  fun setLanguage(value: String?) {
    language = value?.takeIf(String::isNotBlank) ?: "text"
  }

  fun setVariant(value: String?) {
    variant = when (value) {
      "diff" -> "diff"
      "terminal" -> "terminal"
      else -> "code"
    }
  }

  fun setMaximumLines(value: Int) {
    maxLines = value.coerceAtLeast(0)
  }

  fun commitProps() {
    val request = generation.incrementAndGet()
    val source = code
    val requestedLanguage = language
    val requestedVariant = variant
    textView.maxLines = if (maxLines > 0) maxLines else Int.MAX_VALUE
    gutterView.maxLines = textView.maxLines
    gutterView.visibility = if (requestedVariant == "diff") View.VISIBLE else View.GONE
    if (requestedVariant != "diff") gutterView.text = ""
    // Paint source immediately. Highlighting never owns content availability.
    val immediateDiff = if (requestedVariant == "diff") NativeDiffProjector.project(source) else null
    val presentationSource = when {
      immediateDiff != null -> immediateDiff.code
      requestedVariant == "terminal" -> NativeAnsiProjector.project(source).text
      else -> source
    }
    if (immediateDiff != null) gutterView.text = immediateDiff.gutter
    if (textView.text.toString() != presentationSource) textView.text = presentationSource
    pendingTask?.cancel(true)
    scheduledHighlight?.let(mainHandler::removeCallbacks)
    val schedule = Runnable {
      pendingTask = EXECUTOR.submit {
        try {
          val startedAt = SystemClock.elapsedRealtimeNanos()
          val highlighted = NativeCodeHighlighter.highlight(context, source, requestedLanguage, requestedVariant)
          val elapsedMs = (SystemClock.elapsedRealtimeNanos() - startedAt) / 1_000_000.0
          mainHandler.post {
            if (generation.get() == request) {
              textView.text = highlighted.code
              gutterView.text = highlighted.gutter ?: ""
              updateCodeViewportWidth(width)
              if (BuildConfig.DEBUG) {
                Log.d(PERF_TAG, "native_code_highlight_ms=%.1f language=%s variant=%s chars=%d".format(elapsedMs, requestedLanguage, requestedVariant, source.length))
              }
            }
          }
        } catch (_: InterruptedException) {
          // A newer streaming revision superseded this work.
        } catch (_: Exception) {
          // Plain source is already visible. Highlighting is an enhancement and
          // must never turn a valid transcript row into an error boundary.
        }
      }
    }
    scheduledHighlight = schedule
    mainHandler.postDelayed(schedule, HIGHLIGHT_DEBOUNCE_MS)
  }

  fun release() {
    generation.incrementAndGet()
    pendingTask?.cancel(true)
    scheduledHighlight?.let(mainHandler::removeCallbacks)
    pendingTask = null
    scheduledHighlight = null
    mainHandler.removeCallbacksAndMessages(null)
  }

  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    super.onSizeChanged(w, h, oldw, oldh)
    updateCodeViewportWidth(w)
  }

  private fun updateCodeViewportWidth(viewportWidth: Int) {
    val gutterWidth = if (gutterView.visibility == View.VISIBLE) gutterView.measuredWidth else 0
    textView.minWidth = (viewportWidth - gutterWidth).coerceAtLeast(0)
  }

  private fun dp(value: Float): Float = value * resources.displayMetrics.density

  companion object {
    private val TEXT_COLOR = Color.rgb(211, 215, 222)
    private val GUTTER_COLOR = Color.rgb(105, 112, 122)
    private val GUTTER_BACKGROUND = Color.rgb(27, 28, 30)
    private const val HIGHLIGHT_DEBOUNCE_MS = 32L
    private const val PERF_TAG = "CodeWidePerf"
    private val EXECUTOR = Executors.newFixedThreadPool(2) { runnable ->
      Thread(runnable, "codex-native-code").apply { priority = Thread.NORM_PRIORITY - 1 }
    }
  }
}
