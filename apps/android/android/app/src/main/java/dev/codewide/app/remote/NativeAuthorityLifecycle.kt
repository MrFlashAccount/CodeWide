package dev.codewide.app.remote

/**
 * Serializes publication of the native connection service with saved-authority replacement.
 *
 * Socket managers still own their own generations. This lock only closes the startup race:
 * either service restore observes the replacement credentials, or the replacing call observes
 * the published service and revokes every old capability before persisting the replacement.
 */
internal class NativeAuthorityLifecycle {
  private val lock = Any()

  fun <T> access(action: () -> T): T = synchronized(lock) { action() }
}

internal val processNativeAuthorityLifecycle = NativeAuthorityLifecycle()

/** Every server-scoped capability that must be retired before authority replacement. */
internal data class NativeAuthorityRevocation(
  val authenticatedTransports: () -> Unit,
  val notificationProjection: () -> Unit,
  val legacySession: () -> Unit,
  val portForwards: () -> Unit,
  val terminalSessions: () -> Unit,
  val httpProxy: () -> Unit,
)

/** Attempts every revocation even if one owner fails, then rejects authority publication. */
internal fun revokeNativeAuthority(revocation: NativeAuthorityRevocation) {
  var failure: Throwable? = null
  val actions = listOf(
    revocation.authenticatedTransports,
    revocation.notificationProjection,
    revocation.legacySession,
    revocation.portForwards,
    revocation.terminalSessions,
    revocation.httpProxy,
  )
  for (action in actions) {
    try {
      action()
    } catch (error: Throwable) {
      val first = failure
      if (first == null) failure = error else first.addSuppressed(error)
    }
  }
  failure?.let { throw it }
}

/** Executes the security-sensitive replacement order while the service monitor is held. */
internal fun replaceNativeAuthority(
  revoke: () -> Unit,
  persist: () -> Unit,
  resume: () -> Unit,
) {
  revoke()
  persist()
  resume()
}
