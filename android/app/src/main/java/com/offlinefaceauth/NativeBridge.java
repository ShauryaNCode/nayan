package com.offlinefaceauth;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.facebook.react.ReactApplication;
import com.facebook.react.ReactInstanceEventListener;
import com.facebook.react.ReactInstanceManager;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.module.annotations.ReactModule;

import com.offlinefaceauth.keystore.KeystoreManager;

import android.os.Build;
import android.content.res.AssetManager;
import android.media.Image;
import android.util.Base64;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

import com.mrousavy.camera.frameprocessor.Frame;
import javax.crypto.Cipher;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

@ReactModule(name = NativeBridge.NAME)
public final class NativeBridge extends ReactContextBaseJavaModule {
  public static final String NAME = "NativeBridge";
  private static final String DEFAULT_MOBILEFACENET_PATH =
      "/sdcard/Download/mobilefacenet.tflite";
  private static final String DEFAULT_FACEMESH_PATH =
      "/sdcard/Download/face_landmark.tflite";
  private static final String MOBILEFACENET_ASSET =
      "mobilefacenet/mobilefacenet.tflite";
  private static final String FACEMESH_ASSET =
      "facemesh/face_landmark.tflite";
  private static final String DEFAULT_MODEL_PATH = "/sdcard/Download/mobilefacenet.tflite";
  private static final String AES_GCM_TRANSFORMATION = "AES/GCM/NoPadding";
  private static final int DEK_BYTES = 32;
  private static final int GCM_IV_BYTES = 12;
  private static final int GCM_TAG_BITS = 128;
  private static final AtomicBoolean IS_JSI_INSTALLED = new AtomicBoolean(false);
  private static final AtomicBoolean IS_ENGINE_INITIALIZED = new AtomicBoolean(false);
  private static volatile String resolvedMobileFaceNetModelPath = DEFAULT_MOBILEFACENET_PATH;
  private static volatile String resolvedFaceMeshModelPath = DEFAULT_FACEMESH_PATH;

  private static final ExecutorService INFERENCE_EXECUTOR =
      Executors.newSingleThreadExecutor(r -> {
        final Thread t = new Thread(r, "NayanInference");
        t.setPriority(Thread.MAX_PRIORITY - 1);
        return t;
      });

  private static final AtomicReference<FrameData> PENDING_FRAME =
      new AtomicReference<>(null);

  // Reusable direct ByteBuffer to avoid per-frame heap allocation.
  private static volatile ByteBuffer sCachedCopyBuffer;
  private static volatile int sCachedCopyCapacity;

  private static final class FrameData {
    final ByteBuffer yBuffer;
    final int width;
    final int height;
    final int stride;
    final long timestampNs;

    FrameData(ByteBuffer yBuffer, int width, int height, int stride, long timestampNs) {
      this.yBuffer = yBuffer;
      this.width = width;
      this.height = height;
      this.stride = stride;
      this.timestampNs = timestampNs;
    }
  }

  static {
    System.loadLibrary("offline_face_auth_jni");
  }

  private final AtomicBoolean reactInstanceListenerRegistered = new AtomicBoolean(false);

  public NativeBridge(ReactApplicationContext reactContext) {
    super(reactContext);
  }

  public static native void nativeInitialize(String mobileFaceNetModelPath, String faceMeshModelPath);

  public static native void nativeInstallJSI(long jsiRuntimePointer);

  public static native boolean nativeEnqueueFrame(
      ByteBuffer buffer,
      int width,
      int height,
      int stride,
      long timestampNs);

  public static native boolean nativeSubmitModelResult(
      float[] landmarkValues,
      float[] embeddingValues,
      int width,
      int height,
      long timestampNs,
      float inferenceMs);

  public static native void nativeSetLivenessState(int state);

  public static native void nativeSetLivenessChallenge(int challenge);

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
      final String resolvedMobileFaceNetPath =
          resolveModelPath(modelPath, DEFAULT_MOBILEFACENET_PATH, MOBILEFACENET_ASSET);
      final String resolvedFaceMeshPath =
          resolveModelPath(null, DEFAULT_FACEMESH_PATH, FACEMESH_ASSET);
      resolvedMobileFaceNetModelPath = resolvedMobileFaceNetPath;
      resolvedFaceMeshModelPath = resolvedFaceMeshPath;
      TFLiteFrameProcessorRunner.initialize(
          resolvedMobileFaceNetModelPath, resolvedFaceMeshModelPath);
      nativeInitialize(resolvedMobileFaceNetPath, resolvedFaceMeshPath);
      IS_ENGINE_INITIALIZED.set(true);
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
  public void setLivenessChallenge(String challenge, Promise promise) {
    try {
      nativeSetLivenessChallenge(resolveLivenessChallenge(challenge));
      promise.resolve(null);
    } catch (Throwable throwable) {
      promise.reject("E_NATIVE_LIVENESS_CHALLENGE", throwable);
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

  @ReactMethod
  public void generatePersonKey(String personnelId, Promise promise) {
    try {
      KeystoreManager.generatePersonAesGcmKey(personnelId);
      promise.resolve(null);
    } catch (Throwable throwable) {
      promise.reject("E_PERSON_KEY_GENERATE", throwable);
    }
  }

  @ReactMethod
  public void deletePersonKey(String personnelId, Promise promise) {
    try {
      promise.resolve(KeystoreManager.deletePersonAesGcmKey(personnelId));
    } catch (Throwable throwable) {
      promise.reject("E_PERSON_KEY_DELETE", throwable);
    }
  }

  @ReactMethod
  public void wrapDEK(String personnelId, String dekHex, Promise promise) {
    byte[] dek = null;

    try {
      dek = CryptoUtils.hexToBytes(dekHex, DEK_BYTES);
      final SecretKey key = KeystoreManager.getPersonAesGcmKey(personnelId);
      final Cipher cipher = Cipher.getInstance(AES_GCM_TRANSFORMATION);
      final byte[] iv = new byte[GCM_IV_BYTES];
      new SecureRandom().nextBytes(iv);

      cipher.init(
          Cipher.ENCRYPT_MODE,
          key,
          new GCMParameterSpec(GCM_TAG_BITS, iv));

      final byte[] ciphertextAndTag = cipher.doFinal(dek);
      final byte[] wrapped = CryptoUtils.concat(iv, ciphertextAndTag);
      promise.resolve(Base64.encodeToString(wrapped, Base64.NO_WRAP));
    } catch (Throwable throwable) {
      promise.reject("E_PERSON_DEK_WRAP", throwable);
    } finally {
      CryptoUtils.wipe(dek);
    }
  }

  @ReactMethod
  public void unwrapDEK(String personnelId, String wrappedDEKBase64, Promise promise) {
    byte[] plaintext = null;

    try {
      final byte[] wrapped = Base64.decode(wrappedDEKBase64, Base64.NO_WRAP);
      if (wrapped.length <= GCM_IV_BYTES) {
        throw new GeneralSecurityException("wrapped DEK is too short");
      }

      final byte[] iv = Arrays.copyOfRange(wrapped, 0, GCM_IV_BYTES);
      final byte[] ciphertextAndTag =
          Arrays.copyOfRange(wrapped, GCM_IV_BYTES, wrapped.length);
      final SecretKey key = KeystoreManager.getPersonAesGcmKey(personnelId);
      final Cipher cipher = Cipher.getInstance(AES_GCM_TRANSFORMATION);

      cipher.init(
          Cipher.DECRYPT_MODE,
          key,
          new GCMParameterSpec(GCM_TAG_BITS, iv));

      plaintext = cipher.doFinal(ciphertextAndTag);
      if (plaintext.length != DEK_BYTES) {
        throw new GeneralSecurityException("unwrapped DEK is not 32 bytes");
      }

      promise.resolve(CryptoUtils.bytesToHex(plaintext));
    } catch (Throwable throwable) {
      promise.reject("E_PERSON_DEK_UNWRAP", throwable);
    } finally {
      CryptoUtils.wipe(plaintext);
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
      scheduleJsiInstall(reactContext);
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
          scheduleJsiInstall(context);
          reactInstanceManager.removeReactInstanceEventListener(listenerHolder[0]);
          reactInstanceListenerRegistered.set(false);
        };

    reactInstanceManager.addReactInstanceEventListener(listenerHolder[0]);
  }

  private static void scheduleJsiInstall(ReactContext reactContext) {
    reactContext.runOnJSQueueThread(
        () -> {
          final long runtimePointer = reactContext.getJavaScriptContextHolder().get();
          if (runtimePointer == 0L) {
            return;
          }
          if (!IS_JSI_INSTALLED.compareAndSet(false, true)) {
            return;
          }
          try {
            nativeInstallJSI(runtimePointer);
          } catch (Throwable throwable) {
            IS_JSI_INSTALLED.set(false);
            throw throwable;
          }
        });
  }

  private String resolveModelPath(
      @Nullable String requestedPath,
      String defaultExternalPath,
      String assetPath) throws IOException {
    if (requestedPath != null && !requestedPath.trim().isEmpty()) {
      final File requestedFile = new File(requestedPath);
      if (requestedFile.exists() && requestedFile.length() > 0L) {
        return requestedFile.getAbsolutePath();
      }
    }

    final File defaultFile = new File(defaultExternalPath);
    if (defaultFile.exists() && defaultFile.length() > 0L) {
      return defaultFile.getAbsolutePath();
    }

    try {
      return copyAssetModelToFiles(assetPath);
    } catch (IOException ignored) {
      return defaultFile.getAbsolutePath();
    }
  }

  private String copyAssetModelToFiles(String assetPath) throws IOException {
    final ReactApplicationContext context = getReactApplicationContext();
    final AssetManager assets = context.getAssets();
    final File outputFile = new File(context.getFilesDir(), assetPath);
    final File parent = outputFile.getParentFile();
    if (parent != null && !parent.exists() && !parent.mkdirs()) {
      throw new IOException("Failed to create model directory: " + parent);
    }

    try (InputStream input = assets.open(assetPath);
         FileOutputStream output = new FileOutputStream(outputFile, false)) {
      final byte[] buffer = new byte[64 * 1024];
      int read;
      while ((read = input.read(buffer)) != -1) {
        output.write(buffer, 0, read);
      }
    }

    if (outputFile.length() == 0L) {
      throw new IOException("Bundled model asset is empty: " + assetPath);
    }
    return outputFile.getAbsolutePath();
  }

  private static boolean isX86Emulator() {
    for (String abi : Build.SUPPORTED_ABIS) {
      if ("x86".equals(abi) || "x86_64".equals(abi)) {
        return true;
      }
    }
    return false;
  }

  static boolean enqueueVisionCameraFrame(Frame frame) {
    if (frame == null || !IS_ENGINE_INITIALIZED.get()) {
      return false;
    }

    final Image image = frame.getImage();
    try {
      if (image == null || image.getPlanes().length == 0) {
        return false;
      }

      final Image.Plane yPlane = image.getPlanes()[0];
      final ByteBuffer yBuffer = yPlane.getBuffer();
      if (yBuffer == null || !yBuffer.isDirect()) {
        return false;
      }

      return nativeEnqueueFrame(
          yBuffer,
          image.getWidth(),
          image.getHeight(),
          yPlane.getRowStride(),
          image.getTimestamp());
    } finally {
      if (image != null) {
        image.close();
      }
    }
  }

  static boolean processVisionCameraFrame(Frame frame) {
    if (frame == null || !IS_ENGINE_INITIALIZED.get()) {
      return false;
    }

    final Image image = frame.getImage();
    try {
      if (image == null || image.getPlanes().length == 0) {
        return false;
      }

      final Image.Plane yPlane = image.getPlanes()[0];
      final ByteBuffer srcBuffer = yPlane.getBuffer();
      if (srcBuffer == null) {
        return false;
      }

      final int width = image.getWidth();
      final int height = image.getHeight();
      final int stride = yPlane.getRowStride();
      final long timestampNs = image.getTimestamp();

      // Reuse a cached direct ByteBuffer to avoid per-frame allocation.
      final int byteCount = stride * height;
      ByteBuffer copy = sCachedCopyBuffer;
      if (copy == null || sCachedCopyCapacity < byteCount) {
        copy = ByteBuffer.allocateDirect(byteCount);
        copy.order(ByteOrder.nativeOrder());
        sCachedCopyBuffer = copy;
        sCachedCopyCapacity = byteCount;
      }
      copy.clear();
      srcBuffer.position(0);
      srcBuffer.limit(Math.min(srcBuffer.capacity(), byteCount));
      copy.put(srcBuffer);
      copy.rewind();

      final FrameData frameData = new FrameData(copy, width, height, stride, timestampNs);

      // Mailbox pattern: only keep latest frame
      PENDING_FRAME.set(frameData);

      INFERENCE_EXECUTOR.execute(() -> {
        final FrameData data = PENDING_FRAME.getAndSet(null);
        if (data == null) {
          return;
        }
        // Always route through the native C++ pipeline. The C++ FrameProcessorPlugin
        // runs its own optimised FaceMesh + MobileFaceNet inference and — critically —
        // feeds the LivenessFSM with properly computed EAR/MAR/yaw metrics so that
        // liveness challenges (blink, smile, turn) can actually pass.
        nativeEnqueueFrame(
            data.yBuffer, data.width, data.height, data.stride, data.timestampNs);
      });

      return true;
    } finally {
      if (image != null) {
        image.close();
      }
    }
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

  private static int resolveLivenessChallenge(String challenge) {
    if (challenge == null) {
      return 0;
    }

    final String normalized = challenge.trim().toUpperCase();
    if ("BLINK".equals(normalized)) {
      return 1;
    }
    if ("SMILE".equals(normalized)) {
      return 2;
    }
    if ("TURN_LEFT".equals(normalized)) {
      return 3;
    }
    if ("TURN_RIGHT".equals(normalized)) {
      return 4;
    }
    return 0;
  }
}
