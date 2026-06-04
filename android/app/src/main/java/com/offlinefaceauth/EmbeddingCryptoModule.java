package com.offlinefaceauth;

import androidx.annotation.NonNull;

import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.module.annotations.ReactModule;

import android.util.Base64;

import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;

import javax.crypto.AEADBadTagException;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

@ReactModule(name = EmbeddingCryptoModule.NAME)
public final class EmbeddingCryptoModule extends ReactContextBaseJavaModule {
  public static final String NAME = "EmbeddingCrypto";

  private static final String AES_GCM_TRANSFORMATION = "AES/GCM/NoPadding";
  private static final int DEK_BYTES = 32;
  private static final int GCM_IV_BYTES = 12;
  private static final int GCM_TAG_BYTES = 16;
  private static final int GCM_TAG_BITS = 128;

  private final SecureRandom secureRandom = new SecureRandom();

  public EmbeddingCryptoModule(ReactApplicationContext reactContext) {
    super(reactContext);
  }

  @NonNull
  @Override
  public String getName() {
    return NAME;
  }

  @ReactMethod
  public void encrypt(
      String embeddingBase64,
      String personnelId,
      String dekHex,
      Promise promise) {
    byte[] plaintext = null;
    byte[] dek = null;

    try {
      CryptoUtils.requirePersonnelId(personnelId);
      plaintext = Base64.decode(embeddingBase64, Base64.NO_WRAP);
      if (plaintext.length == 0) {
        throw new IllegalArgumentException("plaintext must not be empty");
      }

      dek = CryptoUtils.hexToBytes(dekHex, DEK_BYTES);
      final byte[] iv = new byte[GCM_IV_BYTES];
      secureRandom.nextBytes(iv);

      final Cipher cipher = Cipher.getInstance(AES_GCM_TRANSFORMATION);
      cipher.init(
          Cipher.ENCRYPT_MODE,
          new SecretKeySpec(dek, "AES"),
          new GCMParameterSpec(GCM_TAG_BITS, iv));
      cipher.updateAAD(personnelId.getBytes(StandardCharsets.UTF_8));

      final byte[] ciphertextAndTag = cipher.doFinal(plaintext);
      final byte[] blob = CryptoUtils.concat(iv, ciphertextAndTag);

      promise.resolve(Base64.encodeToString(blob, Base64.NO_WRAP));
    } catch (Throwable throwable) {
      promise.reject("E_EMBED_ENCRYPT", throwable);
    } finally {
      CryptoUtils.wipe(plaintext);
      CryptoUtils.wipe(dek);
    }
  }

  @ReactMethod
  public void decrypt(
      String encryptedBlobBase64,
      String personnelId,
      String dekHex,
      Promise promise) {
    byte[] dek = null;
    byte[] plaintext = null;

    try {
      CryptoUtils.requirePersonnelId(personnelId);
      final byte[] blob = Base64.decode(encryptedBlobBase64, Base64.NO_WRAP);
      if (blob.length <= GCM_IV_BYTES + GCM_TAG_BYTES) {
        throw new IllegalArgumentException(
            "encrypted blob is too short");
      }

      final byte[] iv = new byte[GCM_IV_BYTES];
      final byte[] ciphertextAndTag = new byte[blob.length - GCM_IV_BYTES];
      System.arraycopy(blob, 0, iv, 0, iv.length);
      System.arraycopy(
          blob,
          GCM_IV_BYTES,
          ciphertextAndTag,
          0,
          ciphertextAndTag.length);

      dek = CryptoUtils.hexToBytes(dekHex, DEK_BYTES);
      final Cipher cipher = Cipher.getInstance(AES_GCM_TRANSFORMATION);
      cipher.init(
          Cipher.DECRYPT_MODE,
          new SecretKeySpec(dek, "AES"),
          new GCMParameterSpec(GCM_TAG_BITS, iv));
      cipher.updateAAD(personnelId.getBytes(StandardCharsets.UTF_8));

      plaintext = cipher.doFinal(ciphertextAndTag);

      promise.resolve(Base64.encodeToString(plaintext, Base64.NO_WRAP));
    } catch (AEADBadTagException exception) {
      promise.reject("E_EMBED_AUTH_TAG", "AES-GCM authentication failed", exception);
    } catch (Throwable throwable) {
      promise.reject("E_EMBED_DECRYPT", throwable);
    } finally {
      CryptoUtils.wipe(dek);
      CryptoUtils.wipe(plaintext);
    }
  }
}
