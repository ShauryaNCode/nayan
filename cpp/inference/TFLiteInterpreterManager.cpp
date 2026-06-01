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
  Initialize(modelPath, modelPath);
}

void TFLiteInterpreterManager::Initialize(
    const std::string& mobileFaceNetModelPath,
    const std::string& faceMeshModelPath) {
  std::lock_guard<std::mutex> lock(mutex_);
  if (mobileFaceNetModelPath.empty()) {
    throw std::invalid_argument("mobileFaceNetModelPath must not be empty");
  }
  if (faceMeshModelPath.empty()) {
    throw std::invalid_argument("faceMeshModelPath must not be empty");
  }

  modelPath_ = mobileFaceNetModelPath;
  faceMeshModelPath_ = faceMeshModelPath;
  ConfigureThreadBudget();
  CreateDelegates();
  faceMeshEngine_.LoadModel(faceMeshModelPath_);
  mobileFaceNetRunner_.LoadModel(modelPath_);
  initialized_ = true;
}

bool TFLiteInterpreterManager::InitializeFaceMeshModel(
    const std::string& modelPath) {
  std::lock_guard<std::mutex> lock(mutex_);
  if (modelPath.empty()) {
    return false;
  }

  ConfigureThreadBudget();
  CreateDelegates();
  faceMeshModelPath_ = modelPath;
  initialized_ = true;
  return faceMeshEngine_.LoadModel(modelPath);
}

FaceMeshResult TFLiteInterpreterManager::RunFaceMesh(const uint8_t* grayPixels,
                                                     uint32_t width,
                                                     uint32_t height,
                                                     uint32_t stride) {
  std::lock_guard<std::mutex> lock(mutex_);
  if (!initialized_) {
    return {};
  }

  if (faceMeshEngine_.IsReady()) {
    offlineface::landmarks::ImageFrame frame{};
    frame.pixels = grayPixels;
    frame.width = width;
    frame.height = height;
    frame.stride = stride;
    frame.channels = 1U;
    return FromMetrics(faceMeshEngine_.Run(frame));
  }

  return {};
}

FaceMeshResult TFLiteInterpreterManager::RunFaceMeshLandmarks(
    const float* landmarkValues,
    std::size_t valueCount,
    uint32_t width,
    uint32_t height) const {
  std::lock_guard<std::mutex> lock(mutex_);
  if (landmarkValues == nullptr || valueCount < 468U * 3U) {
    return {};
  }

  const auto landmarks =
      offlineface::landmarks::FaceMeshEngine::ParseLandmarks(
          landmarkValues, valueCount);
  return FromMetrics(offlineface::landmarks::FaceMeshEngine::ComputeMetrics(
      landmarks, width, height));
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

  return mobileFaceNetRunner_.Run(grayPixels, width, height, stride);
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
  result.faceDetected = false;
  result.eyeAspectRatio = 0.0f;
  result.mouthAspectRatio = 0.0f;
  result.yawDegrees = 0.0f;
  result.pitchDegrees = 0.0f;
  result.rollDegrees = 0.0f;
  return result;
}

FaceMeshResult TFLiteInterpreterManager::FromMetrics(
    const offlineface::landmarks::FaceMetrics& metrics) {
  FaceMeshResult result{};
  result.faceDetected = metrics.faceDetected;
  result.eyeAspectRatio = metrics.ear;
  result.mouthAspectRatio = metrics.mar;
  result.yawDegrees = metrics.yaw;
  result.pitchDegrees = metrics.pitch;
  result.rollDegrees = metrics.roll;
  return result;
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
