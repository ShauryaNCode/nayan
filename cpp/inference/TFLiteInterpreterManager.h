#pragma once
#include <cstdint>
#include <mutex>
#include <string>
#include <vector>
namespace offlineface::inference {

struct FaceMeshResult {
  bool faceDetected{false};
  float eyeAspectRatio{0.0f};
  float mouthAspectRatio{0.0f};
  float yawDegrees{0.0f};
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
  FaceMeshResult RunFaceMesh(const uint8_t* grayPixels, uint32_t width, uint32_t height, uint32_t stride);
  std::vector<float> RunEmbedding(const uint8_t* grayPixels, uint32_t width, uint32_t height, uint32_t stride);
  InterpreterThreadBudget GetThreadBudget() const;
  bool IsInitialized() const;
 private:
  TFLiteInterpreterManager() = default;
  FaceMeshResult RunMockFaceMesh(const uint8_t* grayPixels, uint32_t width, uint32_t height, uint32_t stride) const;
  std::vector<float> RunMockEmbedding(const uint8_t* grayPixels, uint32_t width, uint32_t height, uint32_t stride) const;
  void ConfigureThreadBudget();
  void CreateDelegates();
  mutable std::mutex mutex_; std::string modelPath_; bool initialized_{false}; bool useNnapi_{false}; bool useXnnpack_{false}; bool useCoreMl_{false}; bool useMetal_{false}; InterpreterThreadBudget threadBudget_{};
};
}
