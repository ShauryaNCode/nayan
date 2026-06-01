package com.offlinefaceauth;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.facebook.react.ReactApplication;
import com.facebook.react.ReactInstanceEventListener;
import com.facebook.react.ReactInstanceManager;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.module.annotations.ReactModule;

import com.offlinefaceauth.keystore.KeystoreManager;

import android.os.Build;
import android.util.Base64;

import java.nio.ByteBuffer;
import java.security.SecureRandom;
import java.util.concurrent.atomic.AtomicBoolean;

import javax.crypto.Cipher;
import javax.crypto.SecretKey;

@ReactModule(name = NativeBridge.NAME)
public final class NativeBridge extends ReactContextBaseJavaModule {
  public static final String NAME = "NativeBridge";
  private static final String DEFAULT_MODEL_PATH = "/sdcard/Download/mobilefacenet.tflite";
  private static final String AES_GCM_TRANSFORMATION = "AES/GCM/NoPadding";
  private static final AtomicBoolean IS_JSI_INSTALLED = new AtomicBoolean(false);

  static {
    System.loadLibrary("offline_face_auth_jni");
  }

  private final AtomicBoolean reactInstanceListenerRegistered = new AtomicBoolean(false);

  public NativeBridge(ReactApplicationContext reactContext) {
    super(reactContext);
  }

  public static native void nativeInitialize(String modelPath);

  public static native void nativeInstallJSI(long jsiRuntimePointer);

  public static native boolean nativeEnqueueFrame(
      ByteBuffer buffer,
      int width,
      int height,
      int stride,
      long timestampNs);

  public static native void nativeSetLivenessState(int state);

  @NonNull
  @Override
  public String getName() {
    return NAME;
  }

  @Override
  public void initialize() {
    super.initialize();
  }

  @ReactMethod
  public void initializeEngine(@Nullable String modelPath, Promise promise) {
    try {
      final String resolvedPath =
          modelPath == null || modelPath.trim().isEmpty() ? DEFAULT_MODEL_PATH : modelPath;
      nativeInitialize(resolvedPath);
      promise.resolve(null);
    } catch (Throwable throwable) {
      promise.reject("E_NATIVE_INITIALIZE", throwable);
    }
  }

  @ReactMethod
  public void enqueueFrame(
      ByteBuffer buffer,
      int width,
      int height,
      int stride,
      double timestampNs,
      Promise promise) {
    try {
      if (buffer == null) {
        throw new IllegalArgumentException("buffer must not be null");
      }
      final boolean accepted =
          nativeEnqueueFrame(buffer, width, height, stride, (long) timestampNs);
      promise.resolve(accepted);
    } catch (Throwable throwable) {
      promise.reject("E_NATIVE_ENQUEUE", throwable);
    }
  }

  @ReactMethod
  public void setLivenessState(String state, Promise promise) {
    try {
      nativeSetLivenessState(resolveLivenessState(state));
      promise.resolve(null);
    } catch (Throwable throwable) {
      promise.reject("E_NATIVE_LIVENESS_STATE", throwable);
    }
  }

  @ReactMethod
  public void setLivenessPassed(boolean passed, Promise promise) {
    try {
      nativeSetLivenessState(passed ? 3 : 2);
      promise.resolve(null);
    } catch (Throwable throwable) {
      promise.reject("E_NATIVE_LIVENESS_STATE", throwable);
    }
  }

  @ReactMethod
  public void ensureJsiInstalled(Promise promise) {
    try {
      installJSIWhenReady();
      promise.resolve(IS_JSI_INSTALLED.get());
    } catch (Throwable throwable) {
      promise.reject("E_NATIVE_INSTALL_JSI", throwable);
    }
  }

  @ReactMethod
  public void generateSecureRandomBase64(double byteLength, Promise promise) {
    try {
      final int length = (int) byteLength;
      if (length <= 0 || length > 1024) {
        throw new IllegalArgumentException("byteLength must be between 1 and 1024");
      }

      final byte[] randomBytes = new byte[length];
      new SecureRandom().nextBytes(randomBytes);
      promise.resolve(Base64.encodeToString(randomBytes, Base64.NO_WRAP));
    } catch (Throwable throwable) {
      promise.reject("E_SECURE_RANDOM", throwable);
    }
  }

  @ReactMethod
  public void deriveDatabasePassphrase(String nonceBase64, Promise promise) {
    try {
      if (nonceBase64 == null || nonceBase64.trim().isEmpty()) {
        throw new IllegalArgumentException("nonceBase64 must not be empty");
      }

      final byte[] nonce = Base64.decode(nonceBase64, Base64.NO_WRAP);
      final SecretKey key = KeystoreManager.getOrCreateAesGcmKey();
      final Cipher cipher = Cipher.getInstance(AES_GCM_TRANSFORMATION);
      cipher.init(Cipher.ENCRYPT_MODE, key);

      final byte[] iv = cipher.getIV();
      final byte[] ciphertextAndTag = cipher.doFinal(nonce);
      final ByteBuffer envelope =
          ByteBuffer.allocate(1 + iv.length + ciphertextAndTag.length);
      envelope.put((byte) iv.length);
      envelope.put(iv);
      envelope.put(ciphertextAndTag);

      final KeystoreManager.KeyHardwareInfo hardwareInfo =
          KeystoreManager.getHardwareInfo(key);

      final WritableMap result = Arguments.createMap();
      result.putString(
          "passphrase", Base64.encodeToString(envelope.array(), Base64.NO_WRAP));
      result.putString("keyAlias", KeystoreManager.KEY_ALIAS);
      result.putString("provider", resolveKeyProvider(hardwareInfo));
      result.putInt("envelopeVersion", 1);
      promise.resolve(result);
    } catch (Throwable throwable) {
      promise.reject("E_DB_PASSPHRASE", throwable);
    }
  }

  private void installJSIWhenReady() {
    if (IS_JSI_INSTALLED.get()) {
      return;
    }
    if (isX86Emulator()) {
      return;
    }

    final ReactApplicationContext reactContext = getReactApplicationContext();
    if (reactContext.hasActiveReactInstance()) {
      final long runtimePointer = reactContext.getJavaScriptContextHolder().get();
      if (runtimePointer != 0L && IS_JSI_INSTALLED.compareAndSet(false, true)) {
        nativeInstallJSI(runtimePointer);
      }
      return;
    }

    if (!reactInstanceListenerRegistered.compareAndSet(false, true)) {
      return;
    }

    final ReactInstanceManager reactInstanceManager =
        ((ReactApplication) reactContext.getApplicationContext())
            .getReactNativeHost()
            .getReactInstanceManager();

    final ReactInstanceEventListener[] listenerHolder = new ReactInstanceEventListener[1];
    listenerHolder[0] =
        context -> {
          final long runtimePointer = context.getJavaScriptContextHolder().get();
          if (runtimePointer != 0L && IS_JSI_INSTALLED.compareAndSet(false, true)) {
            nativeInstallJSI(runtimePointer);
          }
          reactInstanceManager.removeReactInstanceEventListener(listenerHolder[0]);
          reactInstanceListenerRegistered.set(false);
        };

    reactInstanceManager.addReactInstanceEventListener(listenerHolder[0]);
  }

  private static boolean isX86Emulator() {
    for (String abi : Build.SUPPORTED_ABIS) {
      if ("x86".equals(abi) || "x86_64".equals(abi)) {
        return true;
      }
    }
    return false;
  }

  private static String resolveKeyProvider(KeystoreManager.KeyHardwareInfo hardwareInfo) {
    if (hardwareInfo.strongBoxBacked) {
      return "android_keystore_strongbox";
    }
    if (hardwareInfo.insideSecureHardware) {
      return "android_keystore_tee";
    }
    return "android_keystore_software";
  }

  private static int resolveLivenessState(String state) {
    if (state == null) {
      return 0;
    }

    final String normalized = state.trim().toUpperCase();
    if ("DETECTED".equals(normalized)) {
      return 1;
    }
    if ("CHALLENGE_ACTIVE".equals(normalized)) {
      return 2;
    }
    if ("LIVENESS_PASS".equals(normalized)) {
      return 3;
    }
    if ("LIVENESS_FAIL".equals(normalized)) {
      return 4;
    }
    return 0;
  }
}
