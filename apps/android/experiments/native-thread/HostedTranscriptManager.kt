package dev.codewide.app.rendering

import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.ViewGroupManager
import com.facebook.react.uimanager.annotations.ReactProp
import com.facebook.react.uimanager.events.Event
import kotlin.math.roundToInt

/** Fabric owns row content. RecyclerView owns holders, positions and the requested range. */
class HostedTranscriptManager : ViewGroupManager<HostedTranscript>() {
  override fun getName() = "CodeWideLabHostedTranscript"
  override fun createViewInstance(context: ThemedReactContext) = HostedTranscript(context)
  override fun getChildCount(parent: HostedTranscript) = parent.childrenInReactOrder.size
  override fun getChildAt(parent: HostedTranscript, index: Int) = parent.childrenInReactOrder.getOrNull(index)
  override fun addView(parent: HostedTranscript, child: View, index: Int) = parent.mount(index, child)
  override fun removeViewAt(parent: HostedTranscript, index: Int) = parent.unmount(index)
  @ReactProp(name = "window")
  fun setWindow(view: HostedTranscript, model: ReadableMap?) = view.install(model)
  override fun getExportedCustomDirectEventTypeConstants() = mutableMapOf<String, Any>(
    "topHostedRange" to mapOf("registrationName" to "onHostedRange"),
    "topHostedReady" to mapOf("registrationName" to "onHostedReady"),
  )
}

private class RangeEvent(surface: Int, tag: Int, private val first: Int, private val last: Int) :
  Event<RangeEvent>(surface, tag) {
  override fun getEventName() = "topHostedRange"
  override fun getEventData() = Arguments.createMap().apply { putInt("first", first); putInt("last", last) }
}

private class ReadyEvent(surface: Int, tag: Int) : Event<ReadyEvent>(surface, tag) {
  override fun getEventName() = "topHostedReady"
  override fun getEventData() = Arguments.createMap()
}

class HostedTranscript(private val react: ThemedReactContext) : FrameLayout(react) {
  val childrenInReactOrder = ArrayList<View>()
  private val layout = LinearLayoutManager(react).apply { stackFromEnd = true }
  private val list = RecyclerView(react)
  private var keys = emptyList<String>()
  private val heights = mutableMapOf<String, Int>()
  private val mounted = mutableMapOf<String, View>()
  private var sent = IntRange.EMPTY
  private var scheduled = false
  private var following = true
  private var readySent = false
  private var headInset = 0
  private var tailInset = 0
  private val head = "hosted:padding-top"
  private val tail = "hosted:padding-bottom"
  private var estimate = 1
  private fun px(dp: Double) = (dp * resources.displayMetrics.density).roundToInt()
  private fun rowKey(v: View) = v.getTag(com.facebook.react.R.id.view_tag_native_id) as? String
  private val sizes = View.OnLayoutChangeListener { v, _, top, _, bottom, _, _, _, _ ->
    val key = rowKey(v)
    if (key != null && heights[key] != bottom - top) {
      heights[key] = bottom - top
      (v.parent as? HolderFrame)?.requestLayout()
      refresh()
    }
  }

  private inner class HolderFrame : ViewGroup(react) {
    var boundKey: String? = null
    override fun onMeasure(w: Int, h: Int) {
      // Fabric/Yoga measures the subtree using the same available width as the real viewport.
      setMeasuredDimension(MeasureSpec.getSize(w), when (boundKey) { head -> headInset; tail -> tailInset; else -> heights[boundKey] ?: estimate })
    }
    override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) { /* Fabric lays out content at local (0,0). */ }
    fun show(value: View?) {
      if (getChildAt(0) === value) return
      removeAllViews()
      if (value != null) {
        (value.parent as? ViewGroup)?.removeView(value)
        addView(value)
      }
      requestLayout()
    }
  }
  private inner class Holder(val frame: HolderFrame) : RecyclerView.ViewHolder(frame)
  private val cells = object : RecyclerView.Adapter<Holder>() {
    override fun getItemCount() = keys.size
    override fun onCreateViewHolder(parent: ViewGroup, type: Int) =
      Holder(HolderFrame().apply { layoutParams = RecyclerView.LayoutParams(-1, -2) })
    override fun onBindViewHolder(holder: Holder, position: Int) {
      val key = keys[position]
      holder.frame.boundKey = key
      holder.frame.show(mounted[key])
      holder.frame.requestLayout()
    }
    override fun onViewRecycled(holder: Holder) { holder.frame.show(null); holder.frame.boundKey = null }
  }
  init {
    list.layoutManager = layout
    list.adapter = cells
    list.itemAnimator = null
    list.isVerticalScrollBarEnabled = false
    list.clipToPadding = false
    addView(list, LayoutParams(-1, -1))
    list.addOnScrollListener(object : RecyclerView.OnScrollListener() {
      override fun onScrolled(rv: RecyclerView, dx: Int, dy: Int) = requestRange()
      override fun onScrollStateChanged(rv: RecyclerView, state: Int) {
        if (state == RecyclerView.SCROLL_STATE_DRAGGING) following = false
        if (state == RecyclerView.SCROLL_STATE_IDLE) following = !list.canScrollVertically(1)
      }
    })
  }

  fun install(model: ReadableMap?) {
    if (model == null) return
    val data = requireNotNull(model.getArray("keys"))
    val next = listOf(head) + List(data.size()) { requireNotNull(data.getString(it)) } + tail
    val horizontal = px(model.getDouble("horizontal"))
    headInset = px(model.getDouble("top"))
    tailInset = px(model.getDouble("bottom"))
    list.setPadding(horizontal, 0, horizontal, 0)
    estimate = px(model.getDouble("estimate")).coerceAtLeast(1)
    if (keys != next) {
      val first = layout.findFirstVisibleItemPosition()
      val key = keys.getOrNull(first)
      val offset = layout.findViewByPosition(first)?.top ?: list.paddingTop
      val atEnd = following
      keys = next
      cells.notifyDataSetChanged()
      val anchor = if (key != null && !atEnd) keys.indexOf(key) else -1
      if (anchor >= 0) layout.scrollToPositionWithOffset(anchor, offset - list.paddingTop)
      else if (keys.isNotEmpty()) layout.scrollToPosition(keys.lastIndex)
      sent = IntRange.EMPTY
    }
    refresh()
  }

  fun mount(index: Int, child: View) {
    val key = requireNotNull(rowKey(child)) { "Hosted transcript requires keyed React children" }
    childrenInReactOrder.add(index, child)
    mounted[key] = child
    child.addOnLayoutChangeListener(sizes)
    if (child.isLaidOut && child.width > 0) heights[key] = child.height
    refresh()
  }

  fun unmount(index: Int) {
    val child = childrenInReactOrder.removeAt(index)
    val key = rowKey(child)
    if (mounted[key] === child) mounted.remove(key)
    child.removeOnLayoutChangeListener(sizes)
    (child.parent as? HolderFrame)?.show(null)
    refresh()
  }

  private fun refresh() {
    if (scheduled) return
    scheduled = true
    postOnAnimation {
      scheduled = false
      if (width <= 0 || height <= 0) return@postOnAnimation
      for (i in 0 until list.childCount) {
        val frame = list.getChildAt(i) as HolderFrame
        frame.show(mounted[frame.boundKey])
      }
      if (following && keys.isNotEmpty()) {
        layout.scrollToPositionWithOffset(keys.lastIndex, height - tailInset)
      }
      list.requestLayout()
      list.measure(MeasureSpec.makeMeasureSpec(width, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(height, MeasureSpec.EXACTLY))
      list.layout(0, 0, width, height)
      requestRange()
      if (!readySent && list.childCount > 0) {
        val frames = (0 until list.childCount).map { list.getChildAt(it) as HolderFrame }
          .filter { it.bottom > headInset && it.top < height - tailInset }
        val content = frames.filter { it.boundKey != head && it.boundKey != tail && it.boundKey != "hosted:footer" }
        if (content.isNotEmpty() && content.all { it.childCount == 1 && it.height > 0 && heights[it.boundKey] == it.height }) {
          readySent = true
          UIManagerHelper.getEventDispatcherForReactTag(react,id)?.dispatchEvent(ReadyEvent(UIManagerHelper.getSurfaceId(react),id))
        }
      }
    }
  }

  private fun requestRange() {
    val first = layout.findFirstVisibleItemPosition()
    val last = layout.findLastVisibleItemPosition()
    if (first < 0 || last < first || id == View.NO_ID) return
    // Keep one screen on either side so a fling rarely waits for new Fabric cells.
    if (!sent.isEmpty() && first >= sent.first + 1 && last <= sent.last - 1) return
    val ahead = (last-first+1).coerceAtLeast(4)
    val next = (first-ahead).coerceAtLeast(0)..(last+ahead).coerceAtMost(keys.lastIndex)
    if (next == sent) return
    sent = next
    UIManagerHelper.getEventDispatcherForReactTag(react,id)?.dispatchEvent(RangeEvent(UIManagerHelper.getSurfaceId(react),id,(next.first-1).coerceAtLeast(0),(next.last-1).coerceAtMost(keys.size-3)))
  }
  override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
    super.onLayout(changed,l,t,r,b)
    refresh()
  }
}
