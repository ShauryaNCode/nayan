package com.offlinefaceauth;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.mrousavy.camera.frameprocessor.Frame;
import com.mrousavy.camera.frameprocessor.FrameProcessorPlugin;
import com.mrousavy.camera.frameprocessor.VisionCameraProxy;

import java.util.Map;

public final class NayanFrameProcessorPlugin extends FrameProcessorPlugin {
  public NayanFrameProcessorPlugin(
      @NonNull VisionCameraProxy proxy,
      @Nullable Map<String, Object> options) {
    super();
  }

  @Override
  public Object callback(@NonNull Frame frame, @Nullable Map<String, Object> arguments) {
    return NativeBridge.processVisionCameraFrame(frame);
  }
}
