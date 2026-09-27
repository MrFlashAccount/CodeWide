package dev.codewide.app.remote

/** A socket/handshake belongs to the default route on which its attempt began. */
internal class TransportRouteRecovery {
  enum class Action { KEEP, CONNECT, REPLACE }

  private var attemptEpoch: Long? = null

  fun attemptStarted(epoch: Long) {
    attemptEpoch = epoch
  }

  fun available(epoch: Long, hasTransport: Boolean): Action = when {
    !hasTransport -> Action.CONNECT
    attemptEpoch != epoch -> Action.REPLACE
    else -> Action.KEEP
  }
}
