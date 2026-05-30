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

import java.nio.ByteBuffer;
import java.util.concurrent.atomic.AtomicBoolean;

@ReactModule(name = NativeBridge.NAME)
public final class NativeBridge extends ReactContextBaseJavaModule {
  public static final String NAME = "NativeBridge";
  private static final String DEFAULT_MODEL_PATH = "/sdcard/Download/mobilefacenet.tflite";
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

  private static boolean isX86Emulator() {
    for (String abi : Build.SUPPORTED_ABIS) {
      if ("x86".equals(abi) || "x86_64".equals(abi)) {
        return true;
      }
    }
    return false;
  }
}
