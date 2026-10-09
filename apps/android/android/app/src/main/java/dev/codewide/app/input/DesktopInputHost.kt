package dev.codewide.app.input

import android.graphics.Canvas
import android.view.InputDevice
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.ViewGroup
import android.view.ViewTreeObserver
import android.webkit.WebView
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.events.Event
import com.facebook.react.views.view.ReactViewGroup

/** One native touchpad host retains its pointer and never targets sibling pages or inspectors. */
class DesktopInputHost(private val reactContext: ThemedReactContext) : ReactViewGroup(reactContext) {
  private var inputEnabled = false
  private var modifiers = 0
  private var heldButton = 0
  private var sensitivity = 1f
  private var sessionKey: String? = null
  private var dispatcher: DesktopInputDispatcher? = null
  private var gestureDragging = false
  private var focusObserver: ViewTreeObserver? = null
  private val focusChanges = ViewTreeObserver.OnGlobalFocusChangeListener { before, after ->
    val target = dispatcher?.target
    if (target != null && inside(before, target) && !inside(after, target)) reset()
  }
  private val cursor = DesktopInputCursor(resources.displayMetrics.density)
  private val targetLocation = IntArray(2)
  private val hostLocation = IntArray(2)
  private val configuration = ViewConfiguration.get(context)
  private val gesture = DesktopTouchGesture(configuration.scaledTouchSlop.toFloat(),
    ViewConfiguration.getLongPressTimeout().toLong(), ::touchAction)
  private val hold = Runnable { if (inputEnabled) gesture.hold() }

  fun setInputEnabled(value: Boolean) {
    if (inputEnabled == value) return
    inputEnabled = value && DesktopMouseEventButtons.available
    if (!value) release()
    invalidate()
  }
  fun setModifiers(value: Int) {
    if (value !in 0..7) return
    modifiers = value
    if (inputEnabled) dispatcher?.setModifiers(value)
  }
  fun setHeldButton(value: Int) {
    if (value != 0 && value != 1 && value != 2 && value != 4) return
    heldButton = value
    if (inputEnabled) input()?.let { updateButtons(it) }
  }
  fun setSensitivity(value: Float) { if (value.isFinite() && value in 0.1f..4f) sensitivity = value }
  fun setSessionKey(value: String?) { if (sessionKey != null && sessionKey != value) reset(); sessionKey = value }
  fun click(button: Int) { if (button == 1 || button == 2 || button == 4) input()?.pointer?.click(button) }
  fun key(keyCode: Int, mask: Int) { if (keyCode in 1..KeyEvent.getMaxKeyCode() && mask in 0..7) input()?.key(keyCode, mask) }
  fun keyboard() { input()?.keyboard() }
  fun finish() { inputEnabled = false; release() }

  override fun onInterceptTouchEvent(event: MotionEvent): Boolean {
    if (inputEnabled && event.isFromSource(InputDevice.SOURCE_TOUCHSCREEN) && event.getToolType(0) == MotionEvent.TOOL_TYPE_FINGER) {
      parent?.requestDisallowInterceptTouchEvent(true)
      return true
    }
    return super.onInterceptTouchEvent(event)
  }

  override fun onTouchEvent(event: MotionEvent): Boolean {
    if (!inputEnabled || !event.isFromSource(InputDevice.SOURCE_TOUCHSCREEN)) return super.onTouchEvent(event)
    if (input() == null) return true
    when (event.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        gesture.start(event.x, event.y, event.eventTime)
        postDelayed(hold, ViewConfiguration.getLongPressTimeout().toLong())
      }
      MotionEvent.ACTION_POINTER_DOWN, MotionEvent.ACTION_POINTER_UP -> {
        removeCallbacks(hold)
        centroid(event, if (event.actionMasked == MotionEvent.ACTION_POINTER_UP) event.actionIndex else -1)
      }
      MotionEvent.ACTION_MOVE -> {
        var x = 0f
        var y = 0f
        for (i in 0 until event.pointerCount) { x += event.getX(i); y += event.getY(i) }
        gesture.move(x / event.pointerCount, y / event.pointerCount)
      }
      MotionEvent.ACTION_UP -> { removeCallbacks(hold); gesture.end(event.eventTime) }
      MotionEvent.ACTION_CANCEL -> { removeCallbacks(hold); gesture.cancel() }
    }
    invalidate()
    return true
  }

  override fun dispatchDraw(canvas: Canvas) {
    super.dispatchDraw(canvas)
    if (!inputEnabled) return
    val input = input() ?: return
    input.target.getLocationInWindow(targetLocation)
    getLocationInWindow(hostLocation)
    val x = input.pointer.x + targetLocation[0] - hostLocation[0]
    val y = input.pointer.y + targetLocation[1] - hostLocation[1]
    cursor.draw(canvas, x, y)
  }

  override fun onWindowFocusChanged(hasWindowFocus: Boolean) { super.onWindowFocusChanged(hasWindowFocus); if (!hasWindowFocus) reset() }
  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    focusObserver = viewTreeObserver.also { it.addOnGlobalFocusChangeListener(focusChanges) }
  }
  override fun onDetachedFromWindow() {
    focusObserver?.let { if (it.isAlive) it.removeOnGlobalFocusChangeListener(focusChanges) }
    focusObserver = null
    reset()
    finish()
    super.onDetachedFromWindow()
  }

  private fun centroid(event: MotionEvent, excluded: Int) {
    var x = 0f
    var y = 0f
    var count = 0
    for (i in 0 until event.pointerCount) { if (i != excluded) { x += event.getX(i); y += event.getY(i); count++ } }
    if (count > 0) gesture.changeFingers(x / count, y / count, count)
  }

  private fun touchAction(action: DesktopTouchAction) {
    val input = input() ?: return
    when (action) {
      is DesktopTouchAction.Move -> input.pointer.move(action.dx * sensitivity, action.dy * sensitivity)
      is DesktopTouchAction.Scroll -> {
        val wheelUnit = resources.displayMetrics.density * 48f
        input.pointer.scroll(-action.dx / wheelUnit, -action.dy / wheelUnit)
      }
      is DesktopTouchAction.Click -> input.pointer.click(action.button)
      DesktopTouchAction.DragStart -> { gestureDragging = true; updateButtons(input) }
      DesktopTouchAction.DragEnd -> { gestureDragging = false; updateButtons(input) }
    }
    invalidate()
  }

  private fun input(): DesktopInputDispatcher? {
    if (!inputEnabled || !isShown || !hasWindowFocus()) return null
    val target = singleWebView(this) ?: return null
    val current = dispatcher
    if (current != null && current.target !== target) { reset(); return null }
    if (!target.isAttachedToWindow || target.width == 0 || target.height == 0) return null
    val input = current ?: DesktopInputDispatcher(target, ::reset).also { dispatcher = it }
    input.pointer.viewport(target.width.toFloat(), target.height.toFloat())
    input.setModifiers(modifiers)
    updateButtons(input)
    return input
  }

  private fun updateButtons(input: DesktopInputDispatcher) { input.pointer.setButtons(heldButton or if (gestureDragging) 1 else 0) }

  private fun release() {
    removeCallbacks(hold)
    // Clear the transport before cancellation so a gesture callback cannot re-enter input().
    val previous = dispatcher
    dispatcher = null
    gestureDragging = false
    heldButton = 0
    modifiers = 0
    gesture.cancel()
    previous?.release()
  }

  private fun reset() {
    if (!inputEnabled) { release(); return }
    inputEnabled = false
    release()
    invalidate()
    if (id != View.NO_ID && isAttachedToWindow) {
      UIManagerHelper.getEventDispatcherForReactTag(reactContext, id)?.dispatchEvent(ResetEvent(UIManagerHelper.getSurfaceId(reactContext), id))
    }
  }

  private fun inside(view: View?, target: View): Boolean {
    var current = view
    while (current != null) {
      if (current === target) return true
      current = current.parent as? View
    }
    return false
  }

  private fun singleWebView(root: ViewGroup): WebView? {
    var found: WebView? = null
    var count = 0
    fun visit(view: View) {
      if (view is WebView) { found = view; count++ }
      else if (view is ViewGroup) { for (i in 0 until view.childCount) visit(view.getChildAt(i)) }
    }
    visit(root)
    return if (count == 1) found else null
  }

  private class ResetEvent(surfaceId: Int, viewId: Int) : Event<ResetEvent>(surfaceId, viewId) {
    override fun getEventName(): String = "topInputReset"
    override fun getEventData(): WritableMap = Arguments.createMap()
  }
}
