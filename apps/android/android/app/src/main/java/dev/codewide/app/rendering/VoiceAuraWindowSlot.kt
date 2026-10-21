package dev.codewide.app.rendering

import android.app.Activity
import android.os.IBinder
import android.view.View
import android.view.WindowManager
import dev.codewide.app.diagnostics.NativeAppLogger
import java.lang.ref.WeakReference

/**
 * Owns at most one voice aura window registration.
 *
 * WindowManager registration is synchronous, but `View.isAttachedToWindow` becomes true only after
 * the next traversal. Ownership is therefore recorded when `addView` succeeds; deriving it from the
 * attach state lets a second frame register another window and drop the first one unreachable.
 */
internal class VoiceAuraWindowSlot<V : View>(
  private val createView: (Activity, VoiceAuraWindowSlot<V>) -> V,
  private val createLayoutParams: (IBinder) -> WindowManager.LayoutParams,
) {
  private sealed interface State<out V> {
    object Detached : State<Nothing>

    class Added<V>(
      val view: V,
      val activity: WeakReference<Activity>,
      val manager: WindowManager,
    ) : State<V>
  }

  private var state: State<V> = State.Detached

  /** Returns the registered window for [activity], replacing a window that belongs to another one. */
  fun ensure(activity: Activity?): V? {
    val current = state
    if (activity == null) return (current as? State.Added<V>)?.view
    if (current is State.Added<V> && current.activity.get() === activity) return current.view
    remove()

    val token = activity.window.decorView.windowToken ?: return null
    val manager = activity.windowManager
    val view = createView(activity, this)
    try {
      manager.addView(view, createLayoutParams(token))
    } catch (error: RuntimeException) {
      NativeAppLogger.warn(LOG_TAG, "Could not attach application voice aura overlay", error)
      return null
    }
    state = State.Added(view, WeakReference(activity), manager)
    return view
  }

  /** Unregisters the owned window whether or not its first traversal has attached it yet. */
  fun remove() {
    val current = state as? State.Added<V> ?: return
    state = State.Detached
    removeView(current.manager, current.view)
  }

  /** The activity whose window token hosts the owned window, while it is alive. */
  val activity: Activity?
    get() = (state as? State.Added<V>)?.activity?.get()

  /**
   * Called from the view's `onAttachedToWindow`. Defense in depth: a window this slot does not own
   * must not stay composited for the activity lifetime. Removal is posted because WindowManager
   * cannot remove a view from inside its attach traversal.
   */
  fun onViewAttached(view: View, manager: WindowManager) {
    if (owns(view)) return
    view.post {
      if (!view.isAttachedToWindow || owns(view)) return@post
      NativeAppLogger.warn(LOG_TAG, "Removing orphaned application voice aura overlay")
      removeView(manager, view)
    }
  }

  private fun owns(view: View): Boolean = (state as? State.Added<V>)?.view === view

  private fun removeView(manager: WindowManager, view: View) {
    try {
      manager.removeViewImmediate(view)
    } catch (error: RuntimeException) {
      NativeAppLogger.warn(LOG_TAG, "Could not remove application voice aura overlay", error)
    }
  }

  private companion object {
    private const val LOG_TAG = "CodeWideVoiceAura"
  }
}
