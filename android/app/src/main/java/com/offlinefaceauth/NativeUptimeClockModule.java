package com.offlinefaceauth;

import androidx.annotation.NonNull;

import android.os.SystemClock;

import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.module.annotations.ReactModule;

@ReactModule(name = NativeUptimeClockModule.NAME)
public final class NativeUptimeClockModule extends ReactContextBaseJavaModule {
  public static final String NAME = "NativeUptimeClock";

  public NativeUptimeClockModule(ReactApplicationContext reactContext) {
    super(reactContext);
  }

  @NonNull
  @Override
  public String getName() {
    return NAME;
  }

  @ReactMethod
  public void getUptimeMs(Promise promise) {
    promise.resolve((double) SystemClock.elapsedRealtime());
  }
}
