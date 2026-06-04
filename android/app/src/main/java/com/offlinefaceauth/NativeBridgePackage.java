package com.offlinefaceauth;

import androidx.annotation.NonNull;

import com.facebook.react.ReactPackage;
import com.facebook.react.bridge.NativeModule;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.uimanager.ViewManager;
import com.mrousavy.camera.frameprocessor.FrameProcessorPluginRegistry;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;

public final class NativeBridgePackage implements ReactPackage {
  private static final AtomicBoolean IS_FRAME_PROCESSOR_REGISTERED =
      new AtomicBoolean(false);

  @NonNull
  @Override
  public List<NativeModule> createNativeModules(
      @NonNull ReactApplicationContext reactContext) {
    registerFrameProcessorPlugin();

    final List<NativeModule> modules = new ArrayList<>(4);
    modules.add(new NativeBridge(reactContext));
    modules.add(new EmbeddingCryptoModule(reactContext));
    modules.add(new NativeUptimeClockModule(reactContext));
    modules.add(new LSHModule(reactContext));
    return modules;
  }

  @NonNull
  @Override
  public List<ViewManager> createViewManagers(
      @NonNull ReactApplicationContext reactContext) {
    return Collections.emptyList();
  }

  private static void registerFrameProcessorPlugin() {
    if (!IS_FRAME_PROCESSOR_REGISTERED.compareAndSet(false, true)) {
      return;
    }

    FrameProcessorPluginRegistry.addFrameProcessorPlugin(
        "nayanFaceAuth",
        (proxy, options) -> new NayanFrameProcessorPlugin(proxy, options));
  }
}
