package dev.codewide.app.rendering

import android.content.Context
import android.view.MotionEvent
import android.view.ViewGroup
import android.view.ViewParent
import androidx.core.view.ViewCompat
import com.facebook.react.uimanager.RootView
import com.facebook.react.views.view.ReactViewGroup

/** Protects the whole browser body from both touch interception and Compose scroll handoff. */
class BrowserSheetContentView(context: Context) : ReactViewGroup(context) {
  private var hostRoot: ViewGroup? = null
  private var previousNestedScrolling = false
  private var capturing = false

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    protectHost()
  }

  override fun dispatchTouchEvent(event: MotionEvent): Boolean {
    if (event.actionMasked == MotionEvent.ACTION_DOWN) {
      protectHost()
      capturing = true
      // Bypass gesture-handler roots. RNHost forwards to Compose without disabling JS dispatch.
      hostRoot?.requestDisallowInterceptTouchEvent(true)
    }
    return try {
      // Deliver the complete stream to the page, scroll views and controls, including multi-touch.
      // Empty regions must also retain the stream instead of letting Compose take it over.
      super.dispatchTouchEvent(event) || capturing
    } finally {
      if (event.actionMasked == MotionEvent.ACTION_UP || event.actionMasked == MotionEvent.ACTION_CANCEL) {
        releaseTouch()
      }
    }
  }

  override fun requestDisallowInterceptTouchEvent(disallowIntercept: Boolean) {
    if (capturing) {
      hostRoot?.requestDisallowInterceptTouchEvent(true)
    } else {
      super.requestDisallowInterceptTouchEvent(disallowIntercept)
    }
  }

  override fun onDetachedFromWindow() {
    releaseTouch()
    hostRoot?.let { ViewCompat.setNestedScrollingEnabled(it, previousNestedScrolling) }
    hostRoot = null
    super.onDetachedFromWindow()
  }

  private fun protectHost() {
    if (hostRoot != null) return
    var ancestor: ViewParent? = parent
    while (ancestor != null) {
      if (ancestor is RootView && ancestor is ViewGroup) {
        hostRoot = ancestor
        previousNestedScrolling = ViewCompat.isNestedScrollingEnabled(ancestor)
        // Disable upstream drag/fling offers for the entire attachment, including after touch-up.
        // This RNHost contains only the body. The grip lives in a separate, unprotected RNHost.
        ViewCompat.setNestedScrollingEnabled(ancestor, false)
        return
      }
      ancestor = ancestor.parent
    }
  }

  private fun releaseTouch() {
    capturing = false
    hostRoot?.requestDisallowInterceptTouchEvent(false)
  }
}
