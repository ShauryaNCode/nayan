package com.offlinefaceauth.keystore;

import android.os.Build;
import android.security.keystore.KeyInfo;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;

import java.io.IOException;
import java.security.GeneralSecurityException;
import java.security.KeyStore;

import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.SecretKeyFactory;

public final class KeystoreManager {
  public static final String KEY_ALIAS = "offline_face_auth_db_v1";
  public static final String PERSON_KEY_ALIAS_PREFIX = "face_embed_key_";

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

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      try {
        return generateAesGcmKey(KEY_ALIAS, true);
      } catch (GeneralSecurityException | RuntimeException exception) {
        return generateAesGcmKey(KEY_ALIAS, false);
      }
    }

    return generateAesGcmKey(KEY_ALIAS, false);
  }

  public static void generatePersonAesGcmKey(String personnelId)
      throws GeneralSecurityException, IOException {
    final String alias = getPersonKeyAlias(personnelId);
    final KeyStore keyStore = KeyStore.getInstance(ANDROID_KEYSTORE);
    keyStore.load(null);

    if (keyStore.containsAlias(alias)) {
      throw new GeneralSecurityException("Person key already exists for " + personnelId);
    }

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      try {
        generateAesGcmKey(alias, true);
        return;
      } catch (GeneralSecurityException | RuntimeException exception) {
        generateAesGcmKey(alias, false);
        return;
      }
    }

    generateAesGcmKey(alias, false);
  }

  public static SecretKey getPersonAesGcmKey(String personnelId)
      throws GeneralSecurityException, IOException {
    final String alias = getPersonKeyAlias(personnelId);
    final KeyStore keyStore = KeyStore.getInstance(ANDROID_KEYSTORE);
    keyStore.load(null);

    final SecretKey key = (SecretKey) keyStore.getKey(alias, null);
    if (key == null) {
      throw new GeneralSecurityException("No person key exists for " + personnelId);
    }
    return key;
  }

  public static boolean deletePersonAesGcmKey(String personnelId)
      throws GeneralSecurityException, IOException {
    final String alias = getPersonKeyAlias(personnelId);
    final KeyStore keyStore = KeyStore.getInstance(ANDROID_KEYSTORE);
    keyStore.load(null);

    if (!keyStore.containsAlias(alias)) {
      return false;
    }
    keyStore.deleteEntry(alias);
    return true;
  }

  public static String getPersonKeyAlias(String personnelId) {
    if (personnelId == null || personnelId.trim().isEmpty()) {
      throw new IllegalArgumentException("personnelId must not be empty");
    }
    return PERSON_KEY_ALIAS_PREFIX + personnelId.trim();
  }

  private static SecretKey generateAesGcmKey(String alias, boolean requestStrongBox)
      throws GeneralSecurityException {
    final KeyGenerator keyGenerator =
        KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE);

    final KeyGenParameterSpec.Builder builder =
        new KeyGenParameterSpec.Builder(
                alias, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(AES_KEY_SIZE_BITS)
            .setUserAuthenticationRequired(false)
            .setRandomizedEncryptionRequired(true);

    if (requestStrongBox && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      builder.setIsStrongBoxBacked(true);
    }

    keyGenerator.init(builder.build());
    return keyGenerator.generateKey();
  }

  public static KeyHardwareInfo getHardwareInfo(SecretKey key) {
    try {
      final SecretKeyFactory factory =
          SecretKeyFactory.getInstance(key.getAlgorithm(), ANDROID_KEYSTORE);
      final KeyInfo keyInfo = (KeyInfo) factory.getKeySpec(key, KeyInfo.class);
      final boolean strongBoxBacked =
          Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && keyInfo.isStrongBoxBacked();
      return new KeyHardwareInfo(keyInfo.isInsideSecureHardware(), strongBoxBacked);
    } catch (GeneralSecurityException exception) {
      return new KeyHardwareInfo(false, false);
    }
  }

  public static final class KeyHardwareInfo {
    public final boolean insideSecureHardware;
    public final boolean strongBoxBacked;

    private KeyHardwareInfo(boolean insideSecureHardware, boolean strongBoxBacked) {
      this.insideSecureHardware = insideSecureHardware;
      this.strongBoxBacked = strongBoxBacked;
    }
  }
}
