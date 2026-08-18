package dev.codewide.app.remote

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.Signature
import java.security.spec.ECGenParameterSpec

/** Non-exportable installation identity used to prove possession during session mint. */
internal object DeviceKeyStore {
  fun publicKeySpki(): String = Base64.encodeToString(keyPair().public.encoded, Base64.NO_WRAP)

  fun signPairingClaim(pairingToken: String, deviceName: String, publicKeySpki: String): String =
    sign(
      "codewide-pairing-v1\n${pairingToken}\n${deviceName.trim()}\n${publicKeySpki}"
        .toByteArray(Charsets.UTF_8)
    )

  fun signChallenge(challenge: String): String {
    val bytes = Base64.decode(challenge, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
    return sign(bytes)
  }

  private fun sign(bytes: ByteArray): String {
    val signature = Signature.getInstance("SHA256withECDSA")
    signature.initSign(keyPair().private)
    signature.update(bytes)
    return Base64.encodeToString(signature.sign(), Base64.NO_WRAP)
  }

  @Synchronized
  private fun keyPair(): KeyPair {
    val keyStore = KeyStore.getInstance(KEYSTORE).apply { load(null) }
    val existing = keyStore.getEntry(KEY_ALIAS, null) as? KeyStore.PrivateKeyEntry
    if (existing != null) return KeyPair(existing.certificate.publicKey, existing.privateKey)
    val generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, KEYSTORE)
    generator.initialize(
      KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY)
        .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
        .setDigests(KeyProperties.DIGEST_SHA256)
        .setUserAuthenticationRequired(false)
        .build()
    )
    return generator.generateKeyPair()
  }

  private const val KEYSTORE = "AndroidKeyStore"
  // Keystore aliases are permanent installation identities, not branding.
  private const val KEY_ALIAS = "codex_remote_device_identity_v1"
}
