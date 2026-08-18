package dev.codewide.app.remote

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

internal data class StoredNativeSession(
  val id: String,
  val endpoint: String,
  val token: String,
  val tlsPinSha256: String?,
  val enabled: Boolean = true,
)

/**
 * Process-independent session credentials for the foreground connection service.
 *
 * This encrypted store is the runtime source of truth for connection secrets. It
 * lets Android recreate every enabled native socket after killing the app process;
 * START_REDELIVER_INTENT alone can only redeliver one of many connection intents.
 */
internal class NativeSessionCredentialsStore(context: Context) {
  private val preferences = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)

  fun list(): List<StoredNativeSession> = synchronized(STORE_LOCK) { readUnlocked() }

  fun get(connectionId: String): StoredNativeSession? = synchronized(STORE_LOCK) {
    readUnlocked().firstOrNull { it.id == connectionId }
  }

  fun upsert(session: StoredNativeSession) {
    synchronized(STORE_LOCK) {
      val sessions = readUnlocked().associateByTo(linkedMapOf()) { it.id }
      sessions[session.id] = session
      writeUnlocked(sessions.values.toList())
    }
  }

  fun remove(connectionId: String) {
    synchronized(STORE_LOCK) {
      val sessions = readUnlocked().filterNot { it.id == connectionId }
      writeUnlocked(sessions)
    }
  }

  private fun readUnlocked(): List<StoredNativeSession> {
    val envelopeText = preferences.getString(BLOB_KEY, null) ?: return emptyList()
    return try {
      val envelope = JSONObject(envelopeText)
      require(envelope.getInt("version") == FORMAT_VERSION)
      val iv = Base64.decode(envelope.getString("iv"), Base64.NO_WRAP)
      val ciphertext = Base64.decode(envelope.getString("ciphertext"), Base64.NO_WRAP)
      val cipher = Cipher.getInstance(TRANSFORMATION)
      cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(GCM_TAG_BITS, iv))
      val array = JSONArray(String(cipher.doFinal(ciphertext), Charsets.UTF_8))
      buildList {
        for (index in 0 until array.length()) {
          val value = array.getJSONObject(index)
          val id = value.getString("id")
          val endpoint = value.getString("endpoint")
          val token = value.getString("token")
          val tlsPinSha256 = value.optString("tlsPinSha256").takeIf { it.isNotBlank() }
          val enabled = value.optBoolean("enabled", true)
          if (id.isNotBlank() && endpoint.isNotBlank() && token.length in 32..512) {
            add(StoredNativeSession(id, endpoint, token, tlsPinSha256, enabled))
          }
        }
      }
    } catch (_: Throwable) {
      // Authentication failure, key invalidation or malformed state must never
      // fall back to plaintext or partially recovered credentials.
      preferences.edit().remove(BLOB_KEY).commit()
      emptyList()
    }
  }

  private fun writeUnlocked(sessions: List<StoredNativeSession>) {
    if (sessions.isEmpty()) {
      check(preferences.edit().remove(BLOB_KEY).commit()) { "Could not clear native session credentials" }
      return
    }
    val array = JSONArray()
    sessions.forEach { session ->
      array.put(JSONObject().apply {
        put("id", session.id)
        put("endpoint", session.endpoint)
        put("token", session.token)
        if (session.tlsPinSha256 != null) put("tlsPinSha256", session.tlsPinSha256)
        put("enabled", session.enabled)
      })
    }
    val cipher = Cipher.getInstance(TRANSFORMATION)
    cipher.init(Cipher.ENCRYPT_MODE, key())
    val envelope = JSONObject().apply {
      put("version", FORMAT_VERSION)
      put("iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
      put("ciphertext", Base64.encodeToString(cipher.doFinal(array.toString().toByteArray(Charsets.UTF_8)), Base64.NO_WRAP))
    }
    check(preferences.edit().putString(BLOB_KEY, envelope.toString()).commit()) {
      "Could not persist native session credentials"
    }
  }

  private fun key(): SecretKey {
    val keyStore = KeyStore.getInstance(KEYSTORE).apply { load(null) }
    (keyStore.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
    generator.init(
      KeyGenParameterSpec.Builder(
        KEY_ALIAS,
        KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
      )
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        .setRandomizedEncryptionRequired(true)
        .build()
    )
    return generator.generateKey()
  }

  companion object {
    // CodeWideModule and CodexConnectionService own separate store instances.
    // Lock the encrypted read-modify-write transaction process-wide so concurrent
    // UI edits and service recovery cannot overwrite each other's credentials.
    private val STORE_LOCK = Any()
    private const val PREFERENCES = "codex_remote_native_sessions"
    private const val BLOB_KEY = "encrypted_sessions"
    private const val FORMAT_VERSION = 1
    private const val KEYSTORE = "AndroidKeyStore"
    private const val KEY_ALIAS = "codex_remote_native_session_credentials_v1"
    private const val TRANSFORMATION = "AES/GCM/NoPadding"
    private const val GCM_TAG_BITS = 128
  }
}
