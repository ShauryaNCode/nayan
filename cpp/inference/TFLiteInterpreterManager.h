#pragma once
#include <cstdint>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

#include "../landmarks/FaceMeshEngine.h"
#include "MobileFaceNetRunner.h"

namespace offlineface::inference {

struct FaceMeshResult {
  bool faceDetected{false};
  float eyeAspectRatio{0.0f};
  float mouthAspectRatio{0.0f};
  float yawDegrees{0.0f};
  float pitchDegrees{0.0f};
  float rollDegrees{0.0f};
};

struct InterpreterThreadBudget {
  int faceMeshThreads{2};
  int mobileFaceNetThreads{2};
  int logicalCores{0};
};

class TFLiteInterpreterManager {
 public:
  static TFLiteInterpreterManager& Instance();
  void Initialize(const std::string& modelPath);
  void Initialize(const std::string& mobileFaceNetModelPath,
                  const std::string& faceMeshModelPath);
  bool InitializeFaceMeshModel(const std::string& modelPath);
  FaceMeshResult RunFaceMesh(const uint8_t* grayPixels, uint32_t width, uint32_t height, uint32_t stride);
  FaceMeshResult RunFaceMeshLandmarks(const float* landmarkValues,
                                      std::size_t valueCount,
                                      uint32_t width,
                                      uint32_t height) const;
  std::vector<float> RunEmbedding(const uint8_t* grayPixels, uint32_t width, uint32_t height, uint32_t stride);
  InterpreterThreadBudget GetThreadBudget() const;
  bool IsInitialized() const;
 private:
  TFLiteInterpreterManager() = default;
  FaceMeshResult RunMockFaceMesh(const uint8_t* grayPixels, uint32_t width, uint32_t height, uint32_t stride) const;
  static FaceMeshResult FromMetrics(const offlineface::landmarks::FaceMetrics& metrics);
  void ConfigureThreadBudget();
  void CreateDelegates();
  mutable std::mutex mutex_; std::string modelPath_; std::string faceMeshModelPath_; bool initialized_{false}; bool useNnapi_{false}; bool useXnnpack_{false}; bool useCoreMl_{false}; bool useMetal_{false}; InterpreterThreadBudget threadBudget_{};
  offlineface::landmarks::FaceMeshEngine faceMeshEngine_;
  MobileFaceNetRunner mobileFaceNetRunner_;
};
}
