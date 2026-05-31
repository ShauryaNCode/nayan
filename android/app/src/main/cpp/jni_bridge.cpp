#include <android/bitmap.h>
#include <jni.h>
#include <jsi/jsi.h>

#include <atomic>
#include <cstdint>
#include <memory>
#include <mutex>
#include <stdexcept>
#include <string>
#include <vector>

#include "clahe/AdaptiveClipController.h"
#include "clahe/CLAHEEngine.h"
#include "frame-processor/FrameProcessorPlugin.h"
#include "frame-processor/JSIHostObject.h"
#include "frame-processor/PixelBufferPool.h"
#include "inference/EmbeddingAverager.h"
#include "inference/TFLiteInterpreterManager.h"

namespace jsi = facebook::jsi;

namespace offlineface::jni {
namespace {

constexpr const char* kJavaIllegalArgumentException =
    "java/lang/IllegalArgumentException";
constexpr const char* kJavaIllegalStateException =
    "java/lang/IllegalStateException";
constexpr const char* kJavaRuntimeException = "java/lang/RuntimeException";
constexpr std::size_t kFramePoolCapacity = 3U;
constexpr std::size_t kMaxGrayFrameBytes = 4096U * 4096U;
constexpr const char* kGlobalModuleName = "__offlineFaceAuth";
JavaVM* gJavaVm = nullptr;
std::atomic<bool> gBindingsInstalled{false};

std::mutex gPipelineMutex;
std::shared_ptr<offlineface::frameprocessor::PixelBufferPool> gPixelBufferPool;
std::shared_ptr<offlineface::clahe::CLAHEEngine> gClaheEngine;
std::shared_ptr<offlineface::clahe::AdaptiveClipController>
    gAdaptiveClipController;
std::shared_ptr<offlineface::inference::EmbeddingAverager> gEmbeddingAverager;
std::shared_ptr<offlineface::frameprocessor::FrameProcessorPlugin>
    gFrameProcessorPlugin;

void ThrowJavaException(JNIEnv* env,
                        const char* className,
                        const std::string& message) {
  if (env == nullptr || env->ExceptionCheck()) {
    return;
  }

  jclass exceptionClass = env->FindClass(className);
  if (exceptionClass == nullptr) {
    env->ExceptionClear();
    exceptionClass = env->FindClass(kJavaRuntimeException);
    if (exceptionClass == nullptr) {
      env->ExceptionClear();
      return;
    }
  }

  env->ThrowNew(exceptionClass, message.c_str());
  env->DeleteLocalRef(exceptionClass);
}

class ScopedUtfChars final {
 public:
  ScopedUtfChars(JNIEnv* env, jstring value) : env_(env), value_(value) {
    if (env_ != nullptr && value_ != nullptr) {
      chars_ = env_->GetStringUTFChars(value_, nullptr);
    }
  }

  ~ScopedUtfChars() {
    if (env_ != nullptr && value_ != nullptr && chars_ != nullptr) {
      env_->ReleaseStringUTFChars(value_, chars_);
    }
  }

  const char* c_str() const { return chars_; }
  bool valid() const { return chars_ != nullptr; }

 private:
  JNIEnv* env_{nullptr};
  jstring value_{nullptr};
  const char* chars_{nullptr};
};

std::shared_ptr<offlineface::frameprocessor::FrameProcessorPlugin>
GetOrCreatePipelineLocked() {
  if (gFrameProcessorPlugin != nullptr) {
    return gFrameProcessorPlugin;
  }

  gPixelBufferPool = std::make_shared<offlineface::frameprocessor::PixelBufferPool>(
      kFramePoolCapacity, kMaxGrayFrameBytes);
  gAdaptiveClipController =
      std::make_shared<offlineface::clahe::AdaptiveClipController>();
  gClaheEngine = std::make_shared<offlineface::clahe::CLAHEEngine>();
  gClaheEngine->SetAdaptiveClipController(gAdaptiveClipController.get());
  gEmbeddingAverager =
      std::make_shared<offlineface::inference::EmbeddingAverager>();

  auto interpreterManager =
      std::shared_ptr<offlineface::inference::TFLiteInterpreterManager>(
          &offlineface::inference::TFLiteInterpreterManager::Instance(),
          [](offlineface::inference::TFLiteInterpreterManager*) {});

  gFrameProcessorPlugin =
      std::make_shared<offlineface::frameprocessor::FrameProcessorPlugin>(
          gPixelBufferPool,
          gClaheEngine,
          interpreterManager,
          gEmbeddingAverager);
  return gFrameProcessorPlugin;
}

std::shared_ptr<offlineface::frameprocessor::FrameProcessorPlugin>
GetInitializedPipeline() {
  std::lock_guard<std::mutex> lock(gPipelineMutex);
  return GetOrCreatePipelineLocked();
}

offlineface::frameprocessor::ProcessedFrameResult SnapshotLatestResult() {
  std::lock_guard<std::mutex> lock(gPipelineMutex);
  if (gFrameProcessorPlugin == nullptr) {
    return offlineface::frameprocessor::ProcessedFrameResult{};
  }
  return gFrameProcessorPlugin->DrainLatestResult();
}

offlineface::frameprocessor::NativeLivenessState DecodeLivenessState(
    jint state) {
  using offlineface::frameprocessor::NativeLivenessState;
  switch (state) {
    case 1:
      return NativeLivenessState::kDetected;
    case 2:
      return NativeLivenessState::kChallengeActive;
    case 3:
      return NativeLivenessState::kLivenessPass;
    case 4:
      return NativeLivenessState::kLivenessFail;
    case 0:
    default:
      return NativeLivenessState::kIdle;
  }
}

jsi::Function CreateLatestResultFunction(jsi::Runtime& runtime) {
  return jsi::Function::createFromHostFunction(
      runtime,
      jsi::PropNameID::forAscii(runtime, "getLatestResult"),
      0,
      [](jsi::Runtime& rt,
         const jsi::Value&,
         const jsi::Value*,
         size_t) -> jsi::Value {
        auto hostObject = offlineface::frameprocessor::MakeResultHostObject(
            SnapshotLatestResult());
        return jsi::Value(
            rt, jsi::Object::createFromHostObject(rt, std::move(hostObject)));
      });
}

jsi::Function CreateInitializedFunction(jsi::Runtime& runtime) {
  return jsi::Function::createFromHostFunction(
      runtime,
      jsi::PropNameID::forAscii(runtime, "isInitialized"),
      0,
      [](jsi::Runtime&,
         const jsi::Value&,
         const jsi::Value*,
         size_t) -> jsi::Value {
        const bool initialized =
            offlineface::inference::TFLiteInterpreterManager::Instance()
                .IsInitialized();
        return jsi::Value(initialized);
      });
}

jsi::Function CreateSetLivenessStateFunction(jsi::Runtime& runtime) {
  return jsi::Function::createFromHostFunction(
      runtime,
      jsi::PropNameID::forAscii(runtime, "setLivenessState"),
      1,
      [](jsi::Runtime&,
         const jsi::Value&,
         const jsi::Value* args,
         size_t count) -> jsi::Value {
        if (count < 1 || !args[0].isNumber()) {
          return jsi::Value(false);
        }

        const auto pipeline = offlineface::jni::GetInitializedPipeline();
        pipeline->SetLivenessState(
            offlineface::jni::DecodeLivenessState(
                static_cast<jint>(args[0].asNumber())));
        return jsi::Value(true);
      });
}

void InstallJsiBindings(jsi::Runtime& runtime) {
  const jsi::Value existing =
      runtime.global().getProperty(runtime, kGlobalModuleName);
  if (!existing.isUndefined() && !existing.isNull()) {
    gBindingsInstalled.store(true, std::memory_order_release);
    return;
  }

  jsi::Object module(runtime);
  module.setProperty(
      runtime, "getLatestResult", CreateLatestResultFunction(runtime));
  module.setProperty(
      runtime, "isInitialized", CreateInitializedFunction(runtime));
  module.setProperty(
      runtime, "setLivenessState", CreateSetLivenessStateFunction(runtime));
  module.setProperty(
      runtime,
      "frameProcessorRegistryReady",
      jsi::Value(true));
  runtime.global().setProperty(runtime, kGlobalModuleName, std::move(module));
  gBindingsInstalled.store(true, std::memory_order_release);
}

std::vector<uint8_t> CopyBitmapToGray(JNIEnv* env,
                                      jobject bitmap,
                                      AndroidBitmapInfo& bitmapInfo) {
  const int infoResult = AndroidBitmap_getInfo(env, bitmap, &bitmapInfo);
  if (infoResult != ANDROID_BITMAP_RESULT_SUCCESS) {
    throw std::runtime_error("AndroidBitmap_getInfo failed");
  }
  if (bitmapInfo.width == 0U || bitmapInfo.height == 0U) {
    throw std::invalid_argument("Bitmap dimensions must be non-zero");
  }

  void* pixelAddress = nullptr;
  const int lockResult = AndroidBitmap_lockPixels(env, bitmap, &pixelAddress);
  if (lockResult != ANDROID_BITMAP_RESULT_SUCCESS || pixelAddress == nullptr) {
    throw std::runtime_error("AndroidBitmap_lockPixels failed");
  }

  std::vector<uint8_t> gray(
      static_cast<std::size_t>(bitmapInfo.width) *
      static_cast<std::size_t>(bitmapInfo.height));

  try {
    if (bitmapInfo.format == ANDROID_BITMAP_FORMAT_A_8) {
      const auto* alpha = static_cast<const uint8_t*>(pixelAddress);
      for (uint32_t row = 0; row < bitmapInfo.height; ++row) {
        const uint8_t* rowPtr = alpha + (row * bitmapInfo.stride);
        for (uint32_t column = 0; column < bitmapInfo.width; ++column) {
          gray[(row * bitmapInfo.width) + column] = rowPtr[column];
        }
      }
    } else if (bitmapInfo.format == ANDROID_BITMAP_FORMAT_RGBA_8888 ||
               bitmapInfo.format == ANDROID_BITMAP_FORMAT_RGB_565) {
      const auto* rgba = static_cast<const uint8_t*>(pixelAddress);
      const uint32_t pixelStride =
          bitmapInfo.format == ANDROID_BITMAP_FORMAT_RGB_565 ? 2U : 4U;
      for (uint32_t row = 0; row < bitmapInfo.height; ++row) {
        const uint8_t* rowPtr = rgba + (row * bitmapInfo.stride);
        for (uint32_t column = 0; column < bitmapInfo.width; ++column) {
          if (pixelStride == 4U) {
            const uint8_t blue = rowPtr[(column * pixelStride) + 0U];
            const uint8_t green = rowPtr[(column * pixelStride) + 1U];
            const uint8_t red = rowPtr[(column * pixelStride) + 2U];
            gray[(row * bitmapInfo.width) + column] = static_cast<uint8_t>(
                ((77U * red) + (150U * green) + (29U * blue)) >> 8U);
          } else {
            const uint8_t low = rowPtr[(column * pixelStride) + 0U];
            const uint8_t high = rowPtr[(column * pixelStride) + 1U];
            const uint16_t packedPixel =
                static_cast<uint16_t>(low) |
                (static_cast<uint16_t>(high) << 8U);
            const uint8_t red = static_cast<uint8_t>(((packedPixel >> 11U) & 0x1FU) << 3U);
            const uint8_t green =
                static_cast<uint8_t>(((packedPixel >> 5U) & 0x3FU) << 2U);
            const uint8_t blue = static_cast<uint8_t>((packedPixel & 0x1FU) << 3U);
            gray[(row * bitmapInfo.width) + column] = static_cast<uint8_t>(
                ((77U * red) + (150U * green) + (29U * blue)) >> 8U);
          }
        }
      }
    } else {
      throw std::invalid_argument("Unsupported bitmap format for frame enqueue");
    }
  } catch (...) {
    AndroidBitmap_unlockPixels(env, bitmap);
    throw;
  }

  AndroidBitmap_unlockPixels(env, bitmap);
  return gray;
}

bool EnqueueFromBitmap(JNIEnv* env,
                       jobject bitmap,
                       jlong timestampNs,
                       const std::shared_ptr<
                           offlineface::frameprocessor::FrameProcessorPlugin>&
                           pipeline) {
  AndroidBitmapInfo bitmapInfo{};
  const std::vector<uint8_t> grayFrame =
      CopyBitmapToGray(env, bitmap, bitmapInfo);
  return pipeline->EnqueueGrayFrame(grayFrame.data(),
                                    bitmapInfo.width,
                                    bitmapInfo.height,
                                    bitmapInfo.width,
                                    static_cast<uint64_t>(timestampNs));
}

}  // namespace
}  // namespace offlineface::jni

extern "C" JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void*) {
  offlineface::jni::gJavaVm = vm;
  return JNI_VERSION_1_6;
}

extern "C" JNIEXPORT void JNICALL
Java_com_offlinefaceauth_NativeBridge_nativeInitialize(JNIEnv* env,
                                                       jclass,
                                                       jstring modelPath) {
  try {
    if (modelPath == nullptr) {
      throw std::invalid_argument("modelPath must not be null");
    }

    offlineface::jni::ScopedUtfChars utfChars(env, modelPath);
    if (!utfChars.valid()) {
      throw std::runtime_error("GetStringUTFChars returned null");
    }

    offlineface::inference::TFLiteInterpreterManager::Instance().Initialize(
        std::string(utfChars.c_str()));
    offlineface::jni::GetInitializedPipeline();
    return;
  } catch (const std::invalid_argument& exception) {
    offlineface::jni::ThrowJavaException(
        env, offlineface::jni::kJavaIllegalArgumentException, exception.what());
  } catch (const std::logic_error& exception) {
    offlineface::jni::ThrowJavaException(
        env, offlineface::jni::kJavaIllegalStateException, exception.what());
  } catch (const std::exception& exception) {
    offlineface::jni::ThrowJavaException(
        env, offlineface::jni::kJavaRuntimeException, exception.what());
  } catch (...) {
    offlineface::jni::ThrowJavaException(
        env,
        offlineface::jni::kJavaRuntimeException,
        "nativeInitialize failed with an unknown native exception");
  }
  return;
}

extern "C" JNIEXPORT void JNICALL
Java_com_offlinefaceauth_NativeBridge_nativeInstallJSI(JNIEnv* env,
                                                       jclass,
                                                       jlong runtimePointer) {
  try {
    if (runtimePointer == 0LL) {
      throw std::invalid_argument("runtimePointer must not be zero");
    }
    auto* runtime = reinterpret_cast<jsi::Runtime*>(runtimePointer);
    offlineface::jni::InstallJsiBindings(*runtime);
    return;
  } catch (const std::invalid_argument& exception) {
    offlineface::jni::ThrowJavaException(
        env, offlineface::jni::kJavaIllegalArgumentException, exception.what());
  } catch (const std::exception& exception) {
    offlineface::jni::ThrowJavaException(
        env, offlineface::jni::kJavaRuntimeException, exception.what());
  } catch (...) {
    offlineface::jni::ThrowJavaException(
        env,
        offlineface::jni::kJavaRuntimeException,
        "nativeInstallJSI failed with an unknown native exception");
  }
  return;
}

extern "C" JNIEXPORT jboolean JNICALL
Java_com_offlinefaceauth_NativeBridge_nativeEnqueueFrame(JNIEnv* env,
                                                         jclass,
                                                         jobject planeBuffer,
                                                         jint width,
                                                         jint height,
                                                         jint rowStride,
                                                         jlong timestampNs) {
  try {
    if (planeBuffer == nullptr) {
      throw std::invalid_argument("planeBuffer must not be null");
    }
    if (width <= 0 || height <= 0 || rowStride < width) {
      throw std::invalid_argument("Invalid frame dimensions or row stride");
    }
    if (!offlineface::inference::TFLiteInterpreterManager::Instance()
             .IsInitialized()) {
      throw std::logic_error("nativeInitialize must be called before enqueue");
    }

    const auto pipeline = offlineface::jni::GetInitializedPipeline();
    void* directAddress = env->GetDirectBufferAddress(planeBuffer);
    if (directAddress != nullptr) {
      const jlong capacity = env->GetDirectBufferCapacity(planeBuffer);
      const std::size_t requiredBytes =
          static_cast<std::size_t>(rowStride) * static_cast<std::size_t>(height);
      if (capacity < 0 || static_cast<std::size_t>(capacity) < requiredBytes) {
        throw std::invalid_argument("Direct buffer capacity is smaller than frame");
      }

      const bool accepted = pipeline->EnqueueGrayFrame(
          static_cast<const uint8_t*>(directAddress),
          static_cast<uint32_t>(width),
          static_cast<uint32_t>(height),
          static_cast<uint32_t>(rowStride),
          static_cast<uint64_t>(timestampNs));
      return accepted ? JNI_TRUE : JNI_FALSE;
    }

    const bool accepted =
        offlineface::jni::EnqueueFromBitmap(env, planeBuffer, timestampNs, pipeline);
    return accepted ? JNI_TRUE : JNI_FALSE;
  } catch (const std::invalid_argument& exception) {
    offlineface::jni::ThrowJavaException(
        env, offlineface::jni::kJavaIllegalArgumentException, exception.what());
  } catch (const std::logic_error& exception) {
    offlineface::jni::ThrowJavaException(
        env, offlineface::jni::kJavaIllegalStateException, exception.what());
  } catch (const std::exception& exception) {
    offlineface::jni::ThrowJavaException(
        env, offlineface::jni::kJavaRuntimeException, exception.what());
  } catch (...) {
    offlineface::jni::ThrowJavaException(
        env,
        offlineface::jni::kJavaRuntimeException,
        "nativeEnqueueFrame failed with an unknown native exception");
  }
  return JNI_FALSE;
}

extern "C" JNIEXPORT void JNICALL
Java_com_offlinefaceauth_NativeBridge_nativeSetLivenessState(JNIEnv* env,
                                                             jclass,
                                                             jint state) {
  try {
    const auto pipeline = offlineface::jni::GetInitializedPipeline();
    pipeline->SetLivenessState(offlineface::jni::DecodeLivenessState(state));
    return;
  } catch (const std::exception& exception) {
    offlineface::jni::ThrowJavaException(
        env, offlineface::jni::kJavaRuntimeException, exception.what());
  } catch (...) {
    offlineface::jni::ThrowJavaException(
        env,
        offlineface::jni::kJavaRuntimeException,
        "nativeSetLivenessState failed with an unknown native exception");
  }
  return;
}
