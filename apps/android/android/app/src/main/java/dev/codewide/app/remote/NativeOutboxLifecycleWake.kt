package dev.codewide.app.remote

import org.json.JSONObject

/** Wakes only uncertain commands whose reconciliation may advance after a lifecycle event. */
internal class NativeOutboxLifecycleWake(
  private val expediteThread: (String) -> Boolean,
  private val expediteServerRequest: (String) -> Boolean,
  private val drain: () -> Unit,
) {
  fun observe(method: String, params: JSONObject?) {
    val expedited = when (method) {
      "turn/completed" -> params.threadId()?.let(expediteThread) == true
      "thread/status/changed" -> {
        val status = params?.optJSONObject("status")?.opt("type") as? String
        if (status == "idle" || status == "notLoaded") {
          params.threadId()?.let(expediteThread) == true
        } else {
          false
        }
      }
      "serverRequest/resolved" -> {
        val requestId = params?.opt("requestId")
        if (requestId == null || requestId === JSONObject.NULL) false
        else expediteServerRequest(nativeServerRequestKey(requestId))
      }
      else -> false
    }
    if (expedited) drain()
  }

  private fun JSONObject?.threadId(): String? =
    (this?.opt("threadId") as? String)?.takeIf { it.isNotBlank() }
}

internal fun nativeServerRequestKey(value: Any): String = when (value) {
  is Number -> "number:$value"
  else -> "string:$value"
}
