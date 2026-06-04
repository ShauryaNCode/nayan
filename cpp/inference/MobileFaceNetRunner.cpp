#include "MobileFaceNetRunner.h"

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdio>
#include <cstring>

#if __has_include(<tensorflow/lite/interpreter.h>) && \
    __has_include(<tensorflow/lite/kernels/register.h>) && \
    __has_include(<tensorflow/lite/model.h>) && \
    __has_include(<tensorflow/lite/delegates/xnnpack/xnnpack_delegate.h>)
#define NAYAN_HAS_TFLITE 1
#include <tensorflow/lite/delegates/xnnpack/xnnpack_delegate.h>
#include <tensorflow/lite/interpreter.h>
#include <tensorflow/lite/kernels/register.h>
#include <tensorflow/lite/model.h>
#if defined(__APPLE__) && __has_include(<tensorflow/lite/delegates/coreml/coreml_delegate.h>)
#define NAYAN_HAS_COREML_DELEGATE 1
#include <tensorflow/lite/delegates/coreml/coreml_delegate.h>
#else
#define NAYAN_HAS_COREML_DELEGATE 0
#endif
#if defined(__APPLE__) && __has_include(<tensorflow/lite/delegates/gpu/metal_delegate.h>)
#define NAYAN_HAS_METAL_DELEGATE 1
#include <tensorflow/lite/delegates/gpu/metal_delegate.h>
#else
#define NAYAN_HAS_METAL_DELEGATE 0
#endif
#else
#define NAYAN_HAS_TFLITE 0
#define NAYAN_HAS_COREML_DELEGATE 0
#define NAYAN_HAS_METAL_DELEGATE 0
#endif

#include "../common/MathUtils.h"

namespace offlineface::inference {

namespace {
constexpr std::size_t kEmbeddingSize = 128U;
constexpr int kDefaultInputSize = 112;

bool FileExists(const std::string& path) {
  FILE* file = std::fopen(path.c_str(), "rb");
  if (file == nullptr) {
    return false;
  }
  std::fclose(file);
  return true;
}

uint8_t SampleGrayBilinear(const uint8_t* grayPixels,
                           uint32_t width,
                           uint32_t height,
                           uint32_t stride,
                           int outputX,
                           int outputY,
                           int outputWidth,
                           int outputHeight) {
  const float srcX =
      (static_cast<float>(outputX) + 0.5f) * static_cast<float>(width) /
          static_cast<float>(outputWidth) -
      0.5f;
  const float srcY =
      (static_cast<float>(outputY) + 0.5f) * static_cast<float>(height) /
          static_cast<float>(outputHeight) -
      0.5f;

  const int x0 = std::clamp(static_cast<int>(std::floor(srcX)), 0,
                            static_cast<int>(width) - 1);
  const int y0 = std::clamp(static_cast<int>(std::floor(srcY)), 0,
                            static_cast<int>(height) - 1);
  const int x1 = std::min(x0 + 1, static_cast<int>(width) - 1);
  const int y1 = std::min(y0 + 1, static_cast<int>(height) - 1);
  const float wx = std::clamp(srcX - static_cast<float>(x0), 0.0f, 1.0f);
  const float wy = std::clamp(srcY - static_cast<float>(y0), 0.0f, 1.0f);

  const float p00 = grayPixels[(y0 * stride) + x0];
  const float p10 = grayPixels[(y0 * stride) + x1];
  const float p01 = grayPixels[(y1 * stride) + x0];
  const float p11 = grayPixels[(y1 * stride) + x1];
  const float top = p00 + ((p10 - p00) * wx);
  const float bottom = p01 + ((p11 - p01) * wx);
  return static_cast<uint8_t>(
      std::clamp(top + ((bottom - top) * wy), 0.0f, 255.0f));
}
}  // namespace

class MobileFaceNetRunner::Impl {
 public:
  bool LoadModel(const std::string& modelPath) {
    modelPath_ = modelPath;
    lastError_.clear();
    if (modelPath.empty()) {
      lastError_ = "MobileFaceNet model path is empty";
      ready_.store(false, std::memory_order_release);
      return false;
    }
    if (!FileExists(modelPath)) {
      lastError_ = "MobileFaceNet model file does not exist";
      ready_.store(false, std::memory_order_release);
      return false;
    }

#if NAYAN_HAS_TFLITE
    model_ = tflite::FlatBufferModel::BuildFromFile(modelPath.c_str());
    if (!model_) {
      lastError_ = "Failed to load MobileFaceNet TFLite model";
      ready_.store(false, std::memory_order_release);
      return false;
    }

    tflite::ops::builtin::BuiltinOpResolver resolver;
    tflite::InterpreterBuilder builder(*model_, resolver);
    builder.SetNumThreads(2);
    if (builder(&interpreter_) != kTfLiteOk || !interpreter_) {
      lastError_ = "Failed to create MobileFaceNet interpreter";
      ready_.store(false, std::memory_order_release);
      return false;
    }

#if NAYAN_HAS_COREML_DELEGATE
    TfLiteCoreMlDelegateOptions coreMlOptions = {};
    coreMlDelegate_.reset(TfLiteCoreMlDelegateCreate(&coreMlOptions));
    if (coreMlDelegate_ &&
        interpreter_->ModifyGraphWithDelegate(coreMlDelegate_.get()) !=
            kTfLiteOk) {
      coreMlDelegate_.reset();
    }
#endif
#if NAYAN_HAS_METAL_DELEGATE
    if (coreMlDelegate_ == nullptr) {
      metalDelegate_.reset(TFLGpuDelegateCreate(nullptr));
      if (metalDelegate_ &&
          interpreter_->ModifyGraphWithDelegate(metalDelegate_.get()) !=
              kTfLiteOk) {
        metalDelegate_.reset();
      }
    }
#endif

    TfLiteXNNPackDelegateOptions options =
        TfLiteXNNPackDelegateOptionsDefault();
    options.num_threads = 2;
    if (coreMlDelegate_ == nullptr && metalDelegate_ == nullptr) {
      xnnpackDelegate_.reset(TfLiteXNNPackDelegateCreate(&options));
    }
    if (xnnpackDelegate_ &&
        interpreter_->ModifyGraphWithDelegate(xnnpackDelegate_.get()) !=
            kTfLiteOk) {
      xnnpackDelegate_.reset();
      lastError_ = "XNNPACK delegate creation failed; using CPU interpreter";
    }

    if (interpreter_->AllocateTensors() != kTfLiteOk) {
      lastError_ = "Failed to allocate MobileFaceNet tensors";
      ready_.store(false, std::memory_order_release);
      return false;
    }

    ready_.store(true, std::memory_order_release);
    return true;
#else
    lastError_ =
        "TensorFlow Lite headers are not available in this build; using "
        "deterministic native fallback embedding";
    ready_.store(false, std::memory_order_release);
    return true;
#endif
  }

  bool IsReady() const { return ready_.load(std::memory_order_acquire); }
  std::string LastError() const { return lastError_; }
  const std::string& ModelPath() const { return modelPath_; }

  std::vector<float> Run(const uint8_t* grayPixels,
                         uint32_t width,
                         uint32_t height,
                         uint32_t stride) {
#if NAYAN_HAS_TFLITE
    if (!IsReady() || grayPixels == nullptr || width == 0U || height == 0U ||
        stride < width) {
      return {};
    }

    const int inputIndex =
        interpreter_->inputs().empty() ? -1 : interpreter_->inputs().front();
    if (inputIndex < 0) {
      lastError_ = "MobileFaceNet interpreter has no input tensor";
      return {};
    }

    TfLiteTensor* input = interpreter_->tensor(inputIndex);
    if (input == nullptr || input->dims == nullptr || input->dims->size < 4) {
      lastError_ = "MobileFaceNet input tensor is not NHWC";
      return {};
    }

    const int inputHeight = input->dims->data[1] > 0 ? input->dims->data[1]
                                                     : kDefaultInputSize;
    const int inputWidth = input->dims->data[2] > 0 ? input->dims->data[2]
                                                    : kDefaultInputSize;
    const int channels = input->dims->data[3] > 0 ? input->dims->data[3] : 3;

    if (input->type == kTfLiteFloat32) {
      float* dst = input->data.f;
      for (int y = 0; y < inputHeight; ++y) {
        for (int x = 0; x < inputWidth; ++x) {
          const uint8_t px = SampleGrayBilinear(
              grayPixels, width, height, stride, x, y, inputWidth, inputHeight);
          const float normalized = (static_cast<float>(px) - 127.5f) / 128.0f;
          for (int c = 0; c < channels; ++c) {
            *dst++ = normalized;
          }
        }
      }
    } else if (input->type == kTfLiteUInt8) {
      uint8_t* dst = input->data.uint8;
      for (int y = 0; y < inputHeight; ++y) {
        for (int x = 0; x < inputWidth; ++x) {
          const uint8_t px = SampleGrayBilinear(
              grayPixels, width, height, stride, x, y, inputWidth, inputHeight);
          for (int c = 0; c < channels; ++c) {
            *dst++ = px;
          }
        }
      }
    } else {
      lastError_ = "Unsupported MobileFaceNet input tensor type";
      return {};
    }

    std::atomic_thread_fence(std::memory_order_release);
    if (interpreter_->Invoke() != kTfLiteOk) {
      lastError_ = "MobileFaceNet interpreter Invoke failed";
      return {};
    }
    std::atomic_thread_fence(std::memory_order_acquire);

    for (int outputIndex : interpreter_->outputs()) {
      const TfLiteTensor* output = interpreter_->tensor(outputIndex);
      if (output == nullptr || output->bytes < kEmbeddingSize * sizeof(float)) {
        continue;
      }

      std::vector<float> embedding(kEmbeddingSize, 0.0f);
      if (output->type == kTfLiteFloat32) {
        std::memcpy(
            embedding.data(), output->data.f, kEmbeddingSize * sizeof(float));
      } else if (output->type == kTfLiteUInt8) {
        for (std::size_t i = 0; i < kEmbeddingSize; ++i) {
          embedding[i] =
              (static_cast<int>(output->data.uint8[i]) -
               output->params.zero_point) *
              output->params.scale;
        }
      } else {
        continue;
      }
      offlineface::common::NormalizeL2(embedding.data(), embedding.size());
      return embedding;
    }

    lastError_ = "MobileFaceNet output tensor did not contain 128 floats";
    return {};
#else
    (void)grayPixels;
    (void)width;
    (void)height;
    (void)stride;
    return {};
#endif
  }

 private:
  std::atomic<bool> ready_{false};
  std::string modelPath_;
  std::string lastError_;
#if NAYAN_HAS_TFLITE
  struct XnnpackDeleter {
    void operator()(TfLiteDelegate* delegate) const {
      if (delegate != nullptr) {
        TfLiteXNNPackDelegateDelete(delegate);
      }
    }
  };

  std::unique_ptr<tflite::FlatBufferModel> model_;
  std::unique_ptr<tflite::Interpreter> interpreter_;
  std::unique_ptr<TfLiteDelegate, XnnpackDeleter> xnnpackDelegate_;
#if NAYAN_HAS_COREML_DELEGATE
  struct CoreMlDeleter {
    void operator()(TfLiteDelegate* delegate) const {
      if (delegate != nullptr) {
        TfLiteCoreMlDelegateDelete(delegate);
      }
    }
  };
  std::unique_ptr<TfLiteDelegate, CoreMlDeleter> coreMlDelegate_;
#else
  std::unique_ptr<TfLiteDelegate> coreMlDelegate_;
#endif
#if NAYAN_HAS_METAL_DELEGATE
  struct MetalDeleter {
    void operator()(TfLiteDelegate* delegate) const {
      if (delegate != nullptr) {
        TFLGpuDelegateDelete(delegate);
      }
    }
  };
  std::unique_ptr<TfLiteDelegate, MetalDeleter> metalDelegate_;
#else
  std::unique_ptr<TfLiteDelegate> metalDelegate_;
#endif
#endif
};

MobileFaceNetRunner::MobileFaceNetRunner() : impl_(std::make_unique<Impl>()) {}
MobileFaceNetRunner::~MobileFaceNetRunner() = default;
MobileFaceNetRunner::MobileFaceNetRunner(MobileFaceNetRunner&&) noexcept =
    default;
MobileFaceNetRunner& MobileFaceNetRunner::operator=(
    MobileFaceNetRunner&&) noexcept = default;

bool MobileFaceNetRunner::LoadModel(const std::string& modelPath) {
  return impl_->LoadModel(modelPath);
}

bool MobileFaceNetRunner::IsReady() const {
  return impl_->IsReady();
}

std::string MobileFaceNetRunner::LastError() const {
  return impl_->LastError();
}

const std::string& MobileFaceNetRunner::ModelPath() const {
  return impl_->ModelPath();
}

std::vector<float> MobileFaceNetRunner::Run(const uint8_t* grayPixels,
                                            uint32_t width,
                                            uint32_t height,
                                            uint32_t stride) const {
#if NAYAN_HAS_TFLITE
  if (impl_->IsReady()) {
    return impl_->Run(grayPixels, width, height, stride);
  }
#endif
  return RunDeterministicFallback(grayPixels, width, height, stride);
}

std::vector<float> MobileFaceNetRunner::RunDeterministicFallback(
    const uint8_t* grayPixels,
    uint32_t width,
    uint32_t height,
    uint32_t stride) const {
  if (grayPixels == nullptr || width == 0U || height == 0U || stride < width) {
    return {};
  }

  std::vector<float> embedding(kEmbeddingSize, 0.0f);
  const uint32_t blockWidth = std::max(1U, width / 16U);
  const uint32_t blockHeight = std::max(1U, height / 8U);
  std::size_t slot = 0U;

  for (uint32_t by = 0; by < 8U && slot < kEmbeddingSize; ++by) {
    for (uint32_t bx = 0; bx < 16U && slot < kEmbeddingSize; ++bx) {
      const uint32_t startY = by * blockHeight;
      const uint32_t endY = std::min(height, startY + blockHeight);
      const uint32_t startX = bx * blockWidth;
      const uint32_t endX = std::min(width, startX + blockWidth);

      uint64_t sum = 0U;
      uint64_t edge = 0U;
      uint32_t count = 0U;

      for (uint32_t row = startY; row < endY; ++row) {
        for (uint32_t column = startX; column < endX; ++column) {
          const uint8_t center = grayPixels[(row * stride) + column];
          sum += center;
          if (row > 0U && column > 0U) {
            const int dx =
                static_cast<int>(center) -
                static_cast<int>(grayPixels[(row * stride) + column - 1U]);
            const int dy =
                static_cast<int>(center) -
                static_cast<int>(grayPixels[((row - 1U) * stride) + column]);
            edge += static_cast<uint64_t>(std::abs(dx) + std::abs(dy));
          }
          ++count;
        }
      }

      if (count > 0U) {
        const float luma =
            static_cast<float>(sum) / static_cast<float>(count * 255U);
        const float texture =
            static_cast<float>(edge) / static_cast<float>(count * 510U);
        embedding[slot] = (0.75f * luma) + (0.25f * texture);
      }
      ++slot;
    }
  }

  offlineface::common::NormalizeL2(embedding.data(), embedding.size());
  return embedding;
}

}  // namespace offlineface::inference
