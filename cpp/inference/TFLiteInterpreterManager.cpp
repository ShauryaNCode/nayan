#include "TFLiteInterpreterManager.h"

#include <algorithm>
#include <stdexcept>
#include <thread>

#include "../common/MathUtils.h"

namespace offlineface::inference {

TFLiteInterpreterManager& TFLiteInterpreterManager::Instance() {
  static TFLiteInterpreterManager instance;
  return instance;
}

void TFLiteInterpreterManager::Initialize(const std::string& modelPath) {
  std::lock_guard<std::mutex> lock(mutex_);
  if (modelPath.empty()) {
    throw std::invalid_argument("modelPath must not be empty");
  }

  modelPath_ = modelPath;
  ConfigureThreadBudget();
  CreateDelegates();
  initialized_ = true;
}

FaceMeshResult TFLiteInterpreterManager::RunFaceMesh(const uint8_t* grayPixels,
                                                     uint32_t width,
                                                     uint32_t height,
                                                     uint32_t stride) {
  std::lock_guard<std::mutex> lock(mutex_);
  if (!initialized_) {
    return {};
  }

  return RunMockFaceMesh(grayPixels, width, height, stride);
}

std::vector<float> TFLiteInterpreterManager::RunEmbedding(
    const uint8_t* grayPixels,
    uint32_t width,
    uint32_t height,
    uint32_t stride) {
  std::lock_guard<std::mutex> lock(mutex_);
  if (!initialized_) {
    return {};
  }

  return RunMockEmbedding(grayPixels, width, height, stride);
}

InterpreterThreadBudget TFLiteInterpreterManager::GetThreadBudget() const {
  std::lock_guard<std::mutex> lock(mutex_);
  return threadBudget_;
}

bool TFLiteInterpreterManager::IsInitialized() const {
  std::lock_guard<std::mutex> lock(mutex_);
  return initialized_;
}

FaceMeshResult TFLiteInterpreterManager::RunMockFaceMesh(
    const uint8_t* grayPixels,
    uint32_t width,
    uint32_t height,
    uint32_t stride) const {
  if (grayPixels == nullptr || width == 0U || height == 0U) {
    return {};
  }

  const uint32_t centerX = width / 2U;
  const uint32_t centerY = height / 2U;
  const uint32_t sampleRadiusX = std::max(1U, width / 12U);
  const uint32_t sampleRadiusY = std::max(1U, height / 12U);
  uint64_t centerLuma = 0U;
  uint32_t samples = 0U;

  for (uint32_t y = centerY > sampleRadiusY ? centerY - sampleRadiusY : 0U;
       y < std::min(height, centerY + sampleRadiusY);
       ++y) {
    for (uint32_t x = centerX > sampleRadiusX ? centerX - sampleRadiusX : 0U;
         x < std::min(width, centerX + sampleRadiusX);
         ++x) {
      centerLuma += grayPixels[(y * stride) + x];
      ++samples;
    }
  }

  const float normalizedCenter =
      samples == 0U ? 0.0f : static_cast<float>(centerLuma) /
                                  static_cast<float>(samples * 255U);

  FaceMeshResult result{};
  result.faceDetected = normalizedCenter > 0.05f;
  result.eyeAspectRatio = result.faceDetected ? 0.3f : 0.0f;
  result.mouthAspectRatio = result.faceDetected ? 0.2f : 0.0f;
  result.yawDegrees = 0.0f;
  return result;
}

std::vector<float> TFLiteInterpreterManager::RunMockEmbedding(
    const uint8_t* grayPixels,
    uint32_t width,
    uint32_t height,
    uint32_t stride) const {
  if (grayPixels == nullptr || width == 0U || height == 0U) {
    return {};
  }

  constexpr std::size_t kEmbeddingSize = 128U;
  std::vector<float> embedding(kEmbeddingSize, 0.0f);
  const uint32_t blockWidth = std::max(1U, width / 16U);
  const uint32_t blockHeight = std::max(1U, height / 8U);
  std::size_t slot = 0U;

  for (uint32_t by = 0; by < 8U && slot < kEmbeddingSize; ++by) {
    for (uint32_t bx = 0; bx < 16U && slot < kEmbeddingSize; ++bx) {
      uint64_t sum = 0U;
      uint32_t count = 0U;
      const uint32_t startY = by * blockHeight;
      const uint32_t endY = std::min(height, startY + blockHeight);
      const uint32_t startX = bx * blockWidth;
      const uint32_t endX = std::min(width, startX + blockWidth);

      for (uint32_t row = startY; row < endY; ++row) {
        for (uint32_t column = startX; column < endX; ++column) {
          sum += grayPixels[(row * stride) + column];
          ++count;
        }
      }

      embedding[slot++] =
          count == 0U ? 0.0f
                      : static_cast<float>(sum) /
                            static_cast<float>(count * 255U);
    }
  }

  offlineface::common::NormalizeL2(embedding.data(), embedding.size());
  return embedding;
}

void TFLiteInterpreterManager::ConfigureThreadBudget() {
  const unsigned int detectedCores = std::max(1U, std::thread::hardware_concurrency());
  const int perInterpreterThreads = detectedCores >= 8U ? 3 : 2;

  threadBudget_.logicalCores = static_cast<int>(detectedCores);
  threadBudget_.faceMeshThreads = perInterpreterThreads;
  threadBudget_.mobileFaceNetThreads = perInterpreterThreads;
}

void TFLiteInterpreterManager::CreateDelegates() {
  useNnapi_ = false;
  useXnnpack_ = false;
  useCoreMl_ = false;
  useMetal_ = false;

#if defined(__ANDROID__)
#if __ANDROID_API__ >= 27
  useNnapi_ = true;
#else
  useXnnpack_ = true;
#endif
#elif defined(__APPLE__)
  useCoreMl_ = true;
  useMetal_ = true;
#else
  useXnnpack_ = true;
#endif

  // Future real interpreter construction must apply:
  // facemesh_builder.SetNumThreads(threadBudget_.faceMeshThreads);
  // mobilefacenet_builder.SetNumThreads(threadBudget_.mobileFaceNetThreads);
}

}  // namespace offlineface::inference
