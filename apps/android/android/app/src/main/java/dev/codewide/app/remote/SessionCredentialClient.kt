package dev.codewide.app.remote

import java.io.IOException
import java.net.URI
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.json.JSONObject

internal data class MintedSessionCredential(
  val token: String,
  val expiresAt: Long,
)

internal class SessionAuthorizationException(message: String) : IOException(message)

/** Exchanges the revocable device capability for a short-lived socket token. */
internal object SessionCredentialClient {
  private val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()

  fun mint(
    baseClient: OkHttpClient,
    saved: StoredNativeSession,
    callback: (Result<MintedSessionCredential>) -> Unit,
  ) {
    mintWithClient(
      InnerTlsTransport.client(baseClient, saved),
      InnerTlsTransport.url(saved, saved.endpoint),
      saved.id,
      saved.token,
      callback,
    )
  }

  private fun mintWithClient(
    client: OkHttpClient,
    endpoint: String,
    savedServerId: String,
    capabilityToken: String,
    callback: (Result<MintedSessionCredential>) -> Unit,
  ) {
    try {
      val endpointUri = URI(endpoint)
      val sessionScheme = if (endpointUri.scheme == "wss") "https" else "http"
      val origin = URI(sessionScheme, endpointUri.rawAuthority, null, null, null).toString().removeSuffix("/")
      val challengeRequest = Request.Builder()
        .url("$origin/v1/auth")
        .header("Authorization", "Bearer $capabilityToken")
        .post(JSONObject().put("action", "challenge").toString().toRequestBody(JSON_MEDIA_TYPE))
        .build()
      client.newCall(challengeRequest).enqueue(object : Callback {
        override fun onFailure(call: Call, error: IOException) = callback(Result.failure(error))

        override fun onResponse(call: Call, response: Response) {
          response.use {
            if (!it.isSuccessful) {
              val error = if (it.code == 401 || it.code == 409) SessionAuthorizationException("Session challenge requires pairing")
              else IOException("Session challenge failed (${it.code})")
              callback(Result.failure(error))
              return
            }
            try {
              val body = JSONObject(it.body?.string().orEmpty())
              val challengeId = body.getString("challengeId")
              val challenge = body.getString("challenge")
              val signature = DeviceKeyStore.signChallenge(savedServerId, challenge)
              mintProvenSession(client, "$origin/v1/auth", capabilityToken, challengeId, signature, callback)
            } catch (error: Throwable) {
              callback(Result.failure(error))
            }
          }
        }
      })
    } catch (error: Throwable) {
      callback(Result.failure(error))
    }
  }

  private fun mintProvenSession(
    client: OkHttpClient,
    sessionUrl: String,
    capabilityToken: String,
    challengeId: String,
    signature: String,
    callback: (Result<MintedSessionCredential>) -> Unit,
  ) {
    val requestBody = JSONObject()
      .put("action", "session")
      .put("challengeId", challengeId)
      .put("signature", signature)
      .toString()
      .toRequestBody(JSON_MEDIA_TYPE)
    val request = Request.Builder()
      .url(sessionUrl)
      .header("Authorization", "Bearer $capabilityToken")
      .post(requestBody)
      .build()
    client.newCall(request).enqueue(object : Callback {
      override fun onFailure(call: Call, error: IOException) = callback(Result.failure(error))

      override fun onResponse(call: Call, response: Response) {
        response.use {
          if (!it.isSuccessful) {
            val error = if (it.code == 401 || it.code == 409) SessionAuthorizationException("Session proof requires pairing")
            else IOException("Session mint failed (${it.code})")
            callback(Result.failure(error))
            return
          }
          try {
            val body = JSONObject(it.body?.string().orEmpty())
            val token = body.getString("sessionToken")
            val expiresAt = body.getLong("expiresAt")
            require(token.length in 32..512) { "Session token is invalid" }
            require(expiresAt > System.currentTimeMillis()) { "Session token is already expired" }
            callback(Result.success(MintedSessionCredential(token, expiresAt)))
          } catch (error: Throwable) {
            callback(Result.failure(error))
          }
        }
      }
    })
  }
}
