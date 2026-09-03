package dev.codewide.app.e2e

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import dev.codewide.app.remote.CodexConnectionService
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

/** Shell-only E2E hold around the real native authority/lease monitor. */
class AuthorityRotationFaultReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != ACTION) {
      reject("action-not-allowed")
      return
    }
    when (parseAuthorityRotationFaultMode(intent.getStringExtra(EXTRA_MODE))) {
      AuthorityRotationFaultMode.HOLD_NEXT -> accept(AuthorityRotationFaultController.holdNext())
      AuthorityRotationFaultMode.STATUS -> accept(AuthorityRotationFaultController.status())
      AuthorityRotationFaultMode.RELEASE -> accept(AuthorityRotationFaultController.release())
      null -> reject("mode-not-allowed")
    }
  }

  private fun accept(message: String) {
    resultCode = Activity.RESULT_OK
    resultData = message
  }

  private fun reject(message: String) {
    resultCode = Activity.RESULT_CANCELED
    resultData = message
  }

  companion object {
    const val ACTION = "dev.codewide.app.e2e.AUTHORITY_ROTATION_FAULT"
    const val EXTRA_MODE = "mode"
  }
}

internal enum class AuthorityRotationFaultMode(val wireValue: String) {
  HOLD_NEXT("hold-next"),
  STATUS("status"),
  RELEASE("release"),
}

internal fun parseAuthorityRotationFaultMode(value: String?): AuthorityRotationFaultMode? =
  AuthorityRotationFaultMode.entries.singleOrNull { it.wireValue == value }

private object AuthorityRotationFaultController {
  private data class Hold(
    val release: CountDownLatch,
    val thread: Thread,
  )

  private val lock = Any()
  private var hold: Hold? = null

  fun holdNext(): String {
    val service = CodexConnectionService.instance ?: error("Connection service is not running")
    val acquired = CountDownLatch(1)
    val release = CountDownLatch(1)
    synchronized(lock) {
      if (hold != null) return ARMED
      val holder = thread(name = "CodeWideE2EAuthorityHold", isDaemon = true, start = false) {
        synchronized(service) {
          acquired.countDown()
          release.await()
        }
      }
      hold = Hold(release, holder)
      holder.start()
    }
    if (!acquired.await(HOLD_ACQUIRE_TIMEOUT_SECONDS, TimeUnit.SECONDS)) {
      release.countDown()
      synchronized(lock) { hold = null }
      error("Could not acquire native authority monitor")
    }
    return ARMED
  }

  fun status(): String {
    synchronized(lock) {
      check(hold != null) { "Native authority hold is not armed" }
    }
    return if (hasBlockedAuthorityTransition(Thread.getAllStackTraces())) INTERCEPTED else ARMED
  }

  fun release(): String {
    val active = synchronized(lock) { hold ?: error("Native authority hold is not armed") }
    active.release.countDown()
    active.thread.join(HOLD_RELEASE_TIMEOUT_SECONDS * 1_000L)
    check(!active.thread.isAlive) { "Native authority hold did not release" }
    synchronized(lock) {
      if (hold === active) hold = null
    }
    return RELEASED
  }

  private const val HOLD_ACQUIRE_TIMEOUT_SECONDS = 2L
  private const val HOLD_RELEASE_TIMEOUT_SECONDS = 2L
  private const val ARMED = "authority-rotation-hold-armed"
  private const val INTERCEPTED = "authority-rotation-intercepted"
  private const val RELEASED = "authority-rotation-released"
}

internal fun hasBlockedAuthorityTransition(threads: Map<Thread, Array<StackTraceElement>>): Boolean =
  threads.any { (candidate, stack) ->
    candidate.state == Thread.State.BLOCKED && stack.any(::isAuthorityTransitionFrame)
  }

private fun isAuthorityTransitionFrame(frame: StackTraceElement): Boolean =
  frame.className == CodexConnectionService::class.java.name && frame.methodName in AUTHORITY_TRANSITION_METHODS

private val AUTHORITY_TRANSITION_METHODS = setOf(
  "replaceSavedServerAuthority",
  "activateV2Sync",
  "acquireAuthenticatedTransportLease",
)
