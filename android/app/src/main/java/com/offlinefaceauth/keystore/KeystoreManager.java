package com.offlinefaceauth.keystore;

import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.security.keystore.StrongBoxUnavailableException;

import java.io.IOException;
import java.security.GeneralSecurityException;
import java.security.KeyStore;

import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;

public final class KeystoreManager {
  public static final String KEY_ALIAS = "offline_face_auth_v1";

  private static final String ANDROID_KEYSTORE = "AndroidKeyStore";
  private static final int AES_KEY_SIZE_BITS = 256;

  private KeystoreManager() {}

  public static SecretKey getOrCreateAesGcmKey() throws GeneralSecurityException, IOException {
    final KeyStore keyStore = KeyStore.getInstance(ANDROID_KEYSTORE);
    keyStore.load(null);

    final SecretKey existingKey = (SecretKey) keyStore.getKey(KEY_ALIAS, null);
    if (existingKey != null) {
      return existingKey;
    }

    try {
      return generateAesGcmKey(true);
    } catch (StrongBoxUnavailableException exception) {
      return generateAesGcmKey(false);
    }
  }

  private static SecretKey generateAesGcmKey(boolean requestStrongBox)
      throws GeneralSecurityException {
    final KeyGenerator keyGenerator =
        KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE);

    final KeyGenParameterSpec.Builder builder =
        new KeyGenParameterSpec.Builder(
                KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(AES_KEY_SIZE_BITS)
            .setRandomizedEncryptionRequired(true);

    if (requestStrongBox && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      builder.setIsStrongBoxBacked(true);
    }

    keyGenerator.init(builder.build());
    return keyGenerator.generateKey();
  }
}
