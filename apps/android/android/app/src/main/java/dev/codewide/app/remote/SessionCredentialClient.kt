package dev.codewide.app.remote

import java.io.IOException
import java.net.URI
import android.os.SystemClock
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
    telemetry: NativeTelemetryRecorder = NativeTelemetryRecorder.NONE,
    callback: (Result<MintedSessionCredential>) -> Unit,
  ) {
    mintWithClient(
      InnerTlsTransport.client(baseClient, saved, "credential", telemetry),
      InnerTlsTransport.url(saved, saved.endpoint),
      saved.id,
      saved.token,
      telemetry,
      callback,
    )
  }

  private fun mintWithClient(
    client: OkHttpClient,
    endpoint: String,
    savedServerId: String,
    capabilityToken: String,
    telemetry: NativeTelemetryRecorder,
    callback: (Result<MintedSessionCredential>) -> Unit,
  ) {
    val challengeStartedAt = SystemClock.elapsedRealtimeNanos()
    telemetry.record(NativeTelemetryMetric("connection.auth_challenge", tags = mapOf("phase" to "started")))
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
        override fun onFailure(call: Call, error: IOException) {
          telemetry.record(NativeTelemetryMetric(
            "connection.auth_challenge",
            values = mapOf("durationMs" to elapsedMilliseconds(challengeStartedAt)),
            tags = mapOf("phase" to "failed", "failureKind" to error.javaClass.simpleName),
          ))
          callback(Result.failure(error))
        }

        override fun onResponse(call: Call, response: Response) {
          response.use {
            if (!it.isSuccessful) {
              telemetry.record(NativeTelemetryMetric(
                "connection.auth_challenge",
                values = mapOf(
                  "durationMs" to elapsedMilliseconds(challengeStartedAt),
                  "httpStatus" to it.code,
                  "responseBytes" to maxOf(0L, it.body?.contentLength() ?: 0L),
                ),
                tags = mapOf("phase" to "failed", "failureKind" to "http"),
              ))
              val error = if (it.code == 401 || it.code == 409) SessionAuthorizationException("Session challenge requires pairing")
              else IOException("Session challenge failed (${it.code})")
              callback(Result.failure(error))
              return
            }
            var signatureStartedAt: Long? = null
            try {
              val responseBody = it.body?.string().orEmpty()
              val body = JSONObject(responseBody)
              val challengeId = body.getString("challengeId")
              val challenge = body.getString("challenge")
              telemetry.record(NativeTelemetryMetric(
                "connection.auth_challenge",
                values = mapOf(
                  "durationMs" to elapsedMilliseconds(challengeStartedAt),
                  "httpStatus" to it.code,
                  "responseBytes" to responseBody.toByteArray(Charsets.UTF_8).size,
                ),
                tags = mapOf("phase" to "completed"),
              ))
              val signatureStarted = SystemClock.elapsedRealtimeNanos()
              signatureStartedAt = signatureStarted
              telemetry.record(NativeTelemetryMetric("connection.device_signature", tags = mapOf("phase" to "started")))
              val signature = DeviceKeyStore.signChallenge(savedServerId, challenge)
              telemetry.record(NativeTelemetryMetric(
                "connection.device_signature",
                values = mapOf("durationMs" to elapsedMilliseconds(signatureStarted)),
                tags = mapOf("phase" to "completed"),
              ))
              mintProvenSession(client, "$origin/v1/auth", capabilityToken, challengeId, signature, telemetry, callback)
            } catch (error: Throwable) {
              val metricName = if (signatureStartedAt == null) "connection.auth_challenge" else "connection.device_signature"
              val stageStartedAt = signatureStartedAt ?: challengeStartedAt
              telemetry.record(NativeTelemetryMetric(
                metricName,
                values = mapOf("durationMs" to elapsedMilliseconds(stageStartedAt)),
                tags = mapOf("phase" to "failed", "failureKind" to error.javaClass.simpleName),
              ))
              callback(Result.failure(error))
            }
          }
        }
      })
    } catch (error: Throwable) {
      telemetry.record(NativeTelemetryMetric(
        "connection.auth_challenge",
        values = mapOf("durationMs" to elapsedMilliseconds(challengeStartedAt)),
        tags = mapOf("phase" to "failed", "failureKind" to error.javaClass.simpleName),
      ))
      callback(Result.failure(error))
    }
  }

  private fun mintProvenSession(
    client: OkHttpClient,
    sessionUrl: String,
    capabilityToken: String,
    challengeId: String,
    signature: String,
    telemetry: NativeTelemetryRecorder,
    callback: (Result<MintedSessionCredential>) -> Unit,
  ) {
    val proofStartedAt = SystemClock.elapsedRealtimeNanos()
    telemetry.record(NativeTelemetryMetric("connection.auth_proof", tags = mapOf("phase" to "started")))
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
      override fun onFailure(call: Call, error: IOException) {
        telemetry.record(NativeTelemetryMetric(
          "connection.auth_proof",
          values = mapOf("durationMs" to elapsedMilliseconds(proofStartedAt)),
          tags = mapOf("phase" to "failed", "failureKind" to error.javaClass.simpleName),
        ))
        callback(Result.failure(error))
      }

      override fun onResponse(call: Call, response: Response) {
        response.use {
          if (!it.isSuccessful) {
            telemetry.record(NativeTelemetryMetric(
              "connection.auth_proof",
              values = mapOf(
                "durationMs" to elapsedMilliseconds(proofStartedAt),
                "httpStatus" to it.code,
                "responseBytes" to maxOf(0L, it.body?.contentLength() ?: 0L),
              ),
              tags = mapOf("phase" to "failed", "failureKind" to "http"),
            ))
            val error = if (it.code == 401 || it.code == 409) SessionAuthorizationException("Session proof requires pairing")
            else IOException("Session mint failed (${it.code})")
            callback(Result.failure(error))
            return
          }
          try {
            val responseBody = it.body?.string().orEmpty()
            val body = JSONObject(responseBody)
            val token = body.getString("sessionToken")
            val expiresAt = body.getLong("expiresAt")
            require(token.length in 32..512) { "Session token is invalid" }
            require(expiresAt > System.currentTimeMillis()) { "Session token is already expired" }
            telemetry.record(NativeTelemetryMetric(
              "connection.auth_proof",
              values = mapOf(
                "durationMs" to elapsedMilliseconds(proofStartedAt),
                "httpStatus" to it.code,
                "responseBytes" to responseBody.toByteArray(Charsets.UTF_8).size,
              ),
              tags = mapOf("phase" to "completed"),
            ))
            callback(Result.success(MintedSessionCredential(token, expiresAt)))
          } catch (error: Throwable) {
            telemetry.record(NativeTelemetryMetric(
              "connection.auth_proof",
              values = mapOf("durationMs" to elapsedMilliseconds(proofStartedAt)),
              tags = mapOf("phase" to "failed", "failureKind" to error.javaClass.simpleName),
            ))
            callback(Result.failure(error))
          }
        }
      }
    })
  }
}
