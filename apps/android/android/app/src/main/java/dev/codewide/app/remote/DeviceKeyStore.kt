package dev.codewide.app.remote

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.security.keystore.StrongBoxUnavailableException
import android.util.Base64
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.MessageDigest
import java.security.Principal
import java.security.PrivateKey
import java.security.Signature
import java.security.cert.X509Certificate
import java.security.spec.ECGenParameterSpec
import java.net.Socket
import javax.net.ssl.SSLEngine
import javax.net.ssl.X509ExtendedKeyManager

/** Non-exportable saved-server identities used to prove possession during session mint. */
internal object DeviceKeyStore {
  fun publicKeySpki(savedServerId: String): String =
    Base64.encodeToString(keyPair(savedServerId).public.encoded, Base64.NO_WRAP)

  fun signPairingClaim(savedServerId: String, pairingToken: String, deviceName: String, publicKeySpki: String): String =
    sign(savedServerId, pairingClaimBytes(pairingToken, deviceName, publicKeySpki))

  fun signChallenge(savedServerId: String, challenge: String): String {
    val bytes = Base64.decode(challenge, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
    return sign(savedServerId, bytes)
  }

  /** Presents the saved server's non-exportable identity during TLS 1.3 CertificateVerify. */
  fun clientKeyManager(savedServerId: String): X509ExtendedKeyManager {
    val alias = connectionIdentityAlias(savedServerId)
    val entry = privateKeyEntry(savedServerId)
    return ConnectionKeyManager(alias, entry)
  }

  @Synchronized
  fun delete(savedServerId: String) {
    keyStore().deleteEntry(connectionIdentityAlias(savedServerId))
  }

  @Synchronized
  fun retireLegacyInstallationIdentity() {
    if (legacyIdentityRetired) return
    keyStore().deleteEntry(LEGACY_KEY_ALIAS)
    legacyIdentityRetired = true
  }

  private fun sign(savedServerId: String, bytes: ByteArray): String {
    val signature = Signature.getInstance("SHA256withECDSA")
    signature.initSign(keyPair(savedServerId).private)
    signature.update(bytes)
    return Base64.encodeToString(signature.sign(), Base64.NO_WRAP)
  }

  @Synchronized
  private fun keyPair(savedServerId: String): KeyPair {
    val existing = privateKeyEntry(savedServerId)
    return KeyPair(existing.certificate.publicKey, existing.privateKey)
  }

  @Synchronized
  private fun privateKeyEntry(savedServerId: String): KeyStore.PrivateKeyEntry {
    val alias = connectionIdentityAlias(savedServerId)
    val keyStore = keyStore()
    val existing = keyStore.getEntry(alias, null) as? KeyStore.PrivateKeyEntry
    if (existing != null) return existing
    try {
      generate(alias, strongBox = true)
    } catch (_: StrongBoxUnavailableException) {
      generate(alias, strongBox = false)
    }
    return requireNotNull(keyStore().getEntry(alias, null) as? KeyStore.PrivateKeyEntry) {
      "Generated Android Keystore identity is unavailable"
    }
  }

  private fun generate(alias: String, strongBox: Boolean): KeyPair {
    val generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, KEYSTORE)
    val spec = KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY)
      .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
      // Conscrypt performs TLS 1.3 CertificateVerify through NONEwithECDSA
      // after hashing the transcript itself. SHA-256 remains enabled for the
      // explicit pairing and challenge signatures made by this module.
      .setDigests(KeyProperties.DIGEST_SHA256, KeyProperties.DIGEST_NONE)
      .setUserAuthenticationRequired(false)
      .setIsStrongBoxBacked(strongBox)
      .build()
    generator.initialize(spec)
    return generator.generateKeyPair()
  }

  private fun keyStore(): KeyStore = KeyStore.getInstance(KEYSTORE).apply { load(null) }

  private var legacyIdentityRetired = false
  private const val KEYSTORE = "AndroidKeyStore"
  private const val LEGACY_KEY_ALIAS = "codex_remote_device_identity_v1"

  private class ConnectionKeyManager(
    private val alias: String,
    private val entry: KeyStore.PrivateKeyEntry,
  ) : X509ExtendedKeyManager() {
    override fun getClientAliases(keyType: String?, issuers: Array<out Principal>?): Array<String> =
      if (accepts(keyType)) arrayOf(alias) else emptyArray()

    override fun chooseClientAlias(keyType: Array<out String>?, issuers: Array<out Principal>?, socket: Socket?): String? =
      if (keyType?.any(::accepts) == true) alias else null

    override fun chooseEngineClientAlias(keyType: Array<out String>?, issuers: Array<out Principal>?, engine: SSLEngine?): String? =
      if (keyType?.any(::accepts) == true) alias else null

    override fun getServerAliases(keyType: String?, issuers: Array<out Principal>?): Array<String> = emptyArray()
    override fun chooseServerAlias(keyType: String?, issuers: Array<out Principal>?, socket: Socket?): String? = null
    override fun chooseEngineServerAlias(keyType: String?, issuers: Array<out Principal>?, engine: SSLEngine?): String? = null
    override fun getCertificateChain(requestedAlias: String?): Array<X509Certificate>? =
      if (requestedAlias == alias) entry.certificateChain.map { it as X509Certificate }.toTypedArray() else null

    override fun getPrivateKey(requestedAlias: String?): PrivateKey? =
      if (requestedAlias == alias) entry.privateKey else null

    private fun accepts(keyType: String?): Boolean = keyType?.startsWith("EC", ignoreCase = true) == true
  }
}

internal fun connectionIdentityAlias(savedServerId: String): String {
  require(savedServerId.isNotBlank()) { "Saved server id is required" }
  val digest = MessageDigest.getInstance("SHA-256").digest(savedServerId.toByteArray(Charsets.UTF_8))
  val suffix = digest.joinToString(separator = "") { byte -> "%02x".format(byte.toInt() and 0xff) }
  return "codex_remote_connection_identity_v3_$suffix"
}

internal fun pairingClaimBytes(pairingToken: String, deviceName: String, publicKeySpki: String): ByteArray =
  "codewide-pairing-v2\n${pairingToken}\n${deviceName.trim()}\n${publicKeySpki}".toByteArray(Charsets.UTF_8)
