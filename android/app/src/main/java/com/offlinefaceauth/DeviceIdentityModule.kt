package com.offlinefaceauth

import android.content.pm.PackageManager
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.annotation.NonNull
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.module.annotations.ReactModule
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.Signature
import java.security.spec.ECGenParameterSpec

@ReactModule(name = DeviceIdentityModule.NAME)
class DeviceIdentityModule(
  private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {
  companion object {
    const val NAME = "DeviceIdentityModule"
    private const val ANDROID_KEYSTORE_PROVIDER = "AndroidKeyStore"
    private const val DEVICE_KEY_ALIAS = "device_key_v1"
    private const val DEVICE_KEY_CURVE = "secp256r1"
  }

  @NonNull
  override fun getName(): String = NAME

  @ReactMethod
  fun getOrCreateDeviceKey(promise: Promise) {
    try {
      promise.resolve(getOrCreatePublicKeyBase64())
    } catch (throwable: Throwable) {
      promise.reject("E_DEVICE_KEY", "Failed to get or create device key", throwable)
    }
  }

  @ReactMethod
  fun signDeletionReceipt(receiptJson: String?, promise: Promise) {
    try {
      require(!receiptJson.isNullOrBlank()) { "receiptJson must not be empty" }
      getOrCreatePublicKeyBase64()

      val keyStore = loadKeyStore()
      val privateKey = keyStore.getKey(DEVICE_KEY_ALIAS, null) as? PrivateKey
        ?: throw IllegalStateException("Device private key is unavailable")

      val signer = Signature.getInstance("SHA256withECDSA")
      signer.initSign(privateKey)
      signer.update(receiptJson.toByteArray(Charsets.UTF_8))

      promise.resolve(Base64.encodeToString(signer.sign(), Base64.NO_WRAP))
    } catch (throwable: Throwable) {
      promise.reject(
        "E_DEVICE_RECEIPT_SIGN",
        "Failed to sign deletion receipt",
        throwable,
      )
    }
  }

  private fun getOrCreatePublicKeyBase64(): String {
    val keyStore = loadKeyStore()
    val existingPublicKey = keyStore.getCertificate(DEVICE_KEY_ALIAS)?.publicKey
    val publicKey = existingPublicKey ?: generateDeviceKeyPair().public
    return Base64.encodeToString(publicKey.encoded, Base64.NO_WRAP)
  }

  private fun generateDeviceKeyPair(): KeyPair {
    val preferStrongBox = isStrongBoxAvailable()
    if (preferStrongBox) {
      try {
        return generateDeviceKeyPair(strongBoxBacked = true)
      } catch (_: Throwable) {
        deleteDeviceKeyIfPresent()
      }
    }

    return generateDeviceKeyPair(strongBoxBacked = false)
  }

  private fun generateDeviceKeyPair(strongBoxBacked: Boolean): KeyPair {
    val generator = KeyPairGenerator.getInstance(
      KeyProperties.KEY_ALGORITHM_EC,
      ANDROID_KEYSTORE_PROVIDER,
    )

    val specBuilder = KeyGenParameterSpec.Builder(
      DEVICE_KEY_ALIAS,
      KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY,
    )
      .setAlgorithmParameterSpec(ECGenParameterSpec(DEVICE_KEY_CURVE))
      .setDigests(KeyProperties.DIGEST_SHA256)
      .setUserAuthenticationRequired(false)

    if (strongBoxBacked && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      specBuilder.setIsStrongBoxBacked(true)
    }

    generator.initialize(specBuilder.build())
    return generator.generateKeyPair()
  }

  private fun isStrongBoxAvailable(): Boolean =
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.P &&
      reactContext.packageManager.hasSystemFeature(
        PackageManager.FEATURE_STRONGBOX_KEYSTORE,
      )

  private fun loadKeyStore(): KeyStore =
    KeyStore.getInstance(ANDROID_KEYSTORE_PROVIDER).apply { load(null) }

  private fun deleteDeviceKeyIfPresent() {
    val keyStore = loadKeyStore()
    if (keyStore.containsAlias(DEVICE_KEY_ALIAS)) {
      keyStore.deleteEntry(DEVICE_KEY_ALIAS)
    }
  }
}
