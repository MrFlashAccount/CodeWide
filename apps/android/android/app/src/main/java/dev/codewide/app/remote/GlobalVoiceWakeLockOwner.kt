package dev.codewide.app.remote

import android.os.PowerManager

internal interface GlobalVoiceWakeLock {
  val isHeld: Boolean
  fun acquire(timeoutMs: Long)
  fun release()
}

private class AndroidGlobalVoiceWakeLock(
  private val wakeLock: PowerManager.WakeLock,
) : GlobalVoiceWakeLock {
  override val isHeld: Boolean
    get() = wakeLock.isHeld

  override fun acquire(timeoutMs: Long) = wakeLock.acquire(timeoutMs)

  override fun release() = wakeLock.release()
}

/** Owns CPU wakefulness only for the visible Global Voice activation lifetime. */
internal class GlobalVoiceWakeLockOwner(
  private val wakeLock: GlobalVoiceWakeLock,
) {
  val isHeld: Boolean
    get() = wakeLock.isHeld

  fun setActivationActive(active: Boolean) {
    if (active) {
      if (!wakeLock.isHeld) wakeLock.acquire(MAX_HOLD_MS)
      return
    }
    release()
  }

  fun release() {
    if (wakeLock.isHeld) wakeLock.release()
  }

  companion object {
    private const val MAX_HOLD_MS = 6L * 60L * 60L * 1_000L

    fun create(powerManager: PowerManager): GlobalVoiceWakeLockOwner {
      val wakeLock = powerManager.newWakeLock(
        PowerManager.PARTIAL_WAKE_LOCK,
        "CodeWide:GlobalVoice",
      )
      wakeLock.setReferenceCounted(false)
      return GlobalVoiceWakeLockOwner(AndroidGlobalVoiceWakeLock(wakeLock))
    }
  }
}
