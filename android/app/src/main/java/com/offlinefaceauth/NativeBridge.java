package com.offlinefaceauth;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.facebook.react.ReactApplication;
import com.facebook.react.ReactInstanceEventListener;
import com.facebook.react.ReactInstanceManager;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.module.annotations.ReactModule;

import android.os.Build;
import android.content.res.AssetManager;
import android.media.Image;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.util.concurrent.atomic.AtomicBoolean;

import com.mrousavy.camera.frameprocessor.Frame;

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
  private static final AtomicBoolean IS_JSI_INSTALLED = new AtomicBoolean(false);
  private static final AtomicBoolean IS_ENGINE_INITIALIZED = new AtomicBoolean(false);
  private static volatile String resolvedMobileFaceNetModelPath = DEFAULT_MOBILEFACENET_PATH;
  private static volatile String resolvedFaceMeshModelPath = DEFAULT_FACEMESH_PATH;

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
      long timestampNs);

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
  }

  static boolean processVisionCameraFrame(Frame frame) {
    if (frame == null || !IS_ENGINE_INITIALIZED.get()) {
      return false;
    }

    if (TFLiteFrameProcessorRunner.isReady()) {
      final boolean processed = TFLiteFrameProcessorRunner.process(frame);
      if (processed) {
        return true;
      }
    }

    return enqueueVisionCameraFrame(frame);
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
