package dev.codewide.app.remote

/** Gives explicit UI/resource work priority over a bounded headless subscription. */
internal class V2AuthenticatedLeaseAdmission(
  private val headlessScheduler: V2HeadlessFairScheduler,
  private val acquire: (String) -> String,
  private val stopHeadless: (String) -> Unit,
  private val scheduleFairness: () -> Unit,
) {
  fun acquire(savedServerId: String): String {
    try {
      return acquire.invoke(savedServerId)
    } catch (error: AuthenticatedLeaseCapacityExceededException) {
      val retiringServerId = headlessScheduler.oldestActive() ?: throw error
      stopHeadless.invoke(retiringServerId)
      headlessScheduler.enqueue(retiringServerId)
      scheduleFairness.invoke()
      return acquire.invoke(savedServerId)
    }
  }
}
