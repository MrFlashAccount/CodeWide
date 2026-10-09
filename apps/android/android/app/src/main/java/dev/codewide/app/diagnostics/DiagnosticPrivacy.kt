package dev.codewide.app.diagnostics

import org.json.JSONObject
import org.json.JSONArray

/** Redacts sensitive values, never truncating diagnostic text or stack frames. */
internal object DiagnosticPrivacy {
  private val url = Regex("(?i)\\b(?:https?|wss?|file|content)://[^\\s<>\\\"']+")
  private val email = Regex("[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}")
  private val credentials = Regex("(?i)(\\b(?:authorization|password|passwd|token|secret|api[_-]?key)\\s*[:=]\\s*)(?:Bearer\\s+)?[^\\s,;\\\"'}]+")
  private val bearer = Regex("(?i)\\bBearer\\s+[A-Za-z0-9._~+/=-]+")
  private val apiKey = Regex("\\b(?:sk-|sess-)[A-Za-z0-9_-]{16,}")
  private val jwt = Regex("\\beyJ[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+")
  private val privatePath = Regex("/(?:home|Users|data/user|data/data|storage/emulated)/[^\\s:()\\\"']+")
  private val sensitiveField = Regex("(?i)(?:content|message|payload|prompt|raw|response|text|body|email|username|password|token|secret|credential|authorization|url|endpoint|path|title)")

  fun text(value: String, secrets: Iterable<String> = emptyList()): String {
    var result = value
    for (secret in secrets) if (secret.isNotEmpty()) result = result.replace(secret, "[redacted credential]")
    result = credentials.replace(result, "$1[redacted]")
    result = bearer.replace(result, "Bearer [redacted]")
    result = apiKey.replace(result, "[redacted credential]")
    result = jwt.replace(result, "[redacted credential]")
    result = url.replace(result, "[redacted URL]")
    result = email.replace(result, "[redacted email]")
    return privatePath.replace(result, "[redacted path]")
  }

  fun fields(input: JSONObject, secrets: Iterable<String>): JSONObject = JSONObject().apply {
    for (key in input.keys()) {
      if (sensitiveField.containsMatchIn(key) && key !in setOf("requestId", "documentId", "jobId", "threadId", "turnId", "itemId", "connectionId") && key != "componentStack") continue
      when (val value = input.get(key)) {
        is String -> put(key, text(value, secrets))
        is Number, is Boolean -> put(key, value)
        JSONObject.NULL -> put(key, JSONObject.NULL)
      }
    }
  }

  fun error(input: JSONObject, secrets: Iterable<String>): JSONObject = JSONObject().apply {
    for (key in arrayOf("name", "message", "stack", "nativeStack")) put(key, text(input.optString(key), secrets))
    val causes = JSONArray()
    input.optJSONArray("causes")?.let { entries ->
      for (index in 0 until entries.length()) {
        val cause = entries.getJSONObject(index)
        causes.put(JSONObject().apply {
          for (key in arrayOf("name", "message", "stack", "nativeStack")) put(key, text(cause.optString(key), secrets))
        })
      }
    }
    put("causes", causes)
  }
}
