package dev.codewide.app.remote

import android.content.ContentResolver
import android.net.Uri
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap
import java.io.FileInputStream
import java.io.FileNotFoundException
import java.io.FileOutputStream
import java.io.InputStream
import java.io.OutputStream
import org.json.JSONObject

/** Decodes the React Native request DTO and encodes the native transfer result. */
internal object CompanionHttpBridge {
  const val MAX_REQUEST_JSON_CHARS = 8 * 1024 * 1024

  fun parse(requestJson: String): CompanionHttpRequest {
    require(requestJson.length <= MAX_REQUEST_JSON_CHARS) { "Companion HTTP request is too large" }
    val json = JSONObject(requestJson)
    val headers = json.getJSONArray("headers").let { array ->
      List(array.length()) { index ->
        val entry = array.getJSONArray(index)
        require(entry.length() == 2) { "Companion HTTP header entry is invalid" }
        entry.getString(0) to entry.getString(1)
      }
    }
    return CompanionHttpRequest(
      requestId = json.getString("requestId"),
      connectionId = json.getString("connectionId"),
      method = json.getString("method"),
      path = json.getString("path"),
      headers = headers,
      body = body(json.getJSONObject("body")),
      sink = sink(json.getJSONObject("sink")),
    )
  }

  fun encode(result: CompanionHttpResult): WritableMap = Arguments.createMap().apply {
    putInt("status", result.status)
    putArray("headers", Arguments.createArray().apply {
      result.headers.forEach { (name, value) ->
        pushArray(Arguments.createArray().apply {
          pushString(name)
          pushString(value)
        })
      }
    })
    putMap("payload", Arguments.createMap().apply {
      when (val payload = result.payload) {
        CompanionHttpPayload.None -> putString("kind", "none")
        is CompanionHttpPayload.Text -> {
          putString("kind", "text")
          putString("text", payload.text)
        }
        is CompanionHttpPayload.File -> {
          putString("kind", "file")
          putDouble("bytes", payload.bytes.toDouble())
        }
      }
    })
  }

  private fun body(json: JSONObject): CompanionHttpBody = when (val kind = json.getString("kind")) {
    "none" -> CompanionHttpBody.None
    "text" -> CompanionHttpBody.Text(json.getString("text"))
    "file" -> CompanionHttpBody.FileSlice(
      uri = json.getString("uri"),
      offset = exactLong(json, "offset"),
      length = exactLong(json, "length"),
    )
    else -> throw IllegalArgumentException("Companion HTTP body kind is invalid: $kind")
  }

  private fun sink(json: JSONObject): CompanionHttpSink = when (val kind = json.getString("kind")) {
    "discard" -> CompanionHttpSink.Discard
    "text" -> CompanionHttpSink.Text
    "file" -> CompanionHttpSink.File(json.getString("uri"), json.getBoolean("append"))
    else -> throw IllegalArgumentException("Companion HTTP sink kind is invalid: $kind")
  }

  private fun exactLong(json: JSONObject, name: String): Long {
    val value = json.getDouble(name)
    require(value >= 0.0 && value <= MAX_SAFE_INTEGER && value == Math.floor(value)) {
      "Companion HTTP $name is invalid"
    }
    return value.toLong()
  }

  private const val MAX_SAFE_INTEGER = 9_007_199_254_740_991.0
}

/** App-private files and Storage Access Framework documents chosen by the user. */
internal class ContentResolverCompanionHttpFiles(
  private val resolver: ContentResolver,
) : NativeCompanionHttpFiles {
  override fun openInput(uri: String): InputStream {
    val parsed = Uri.parse(uri)
    return when (parsed.scheme) {
      "file" -> FileInputStream(requireNotNull(parsed.path) { "Upload file path is missing" })
      "content" -> resolver.openInputStream(parsed) ?: throw FileNotFoundException("Upload file is unavailable")
      else -> throw IllegalArgumentException("Upload file URI is not supported")
    }
  }

  override fun openOutput(uri: String, append: Boolean): OutputStream {
    val parsed = Uri.parse(uri)
    return when (parsed.scheme) {
      "file" -> FileOutputStream(requireNotNull(parsed.path) { "Download file path is missing" }, append)
      "content" -> resolver.openOutputStream(parsed, if (append) "wa" else "wt")
        ?: throw FileNotFoundException("Download file is unavailable")
      else -> throw IllegalArgumentException("Download file URI is not supported")
    }
  }
}
