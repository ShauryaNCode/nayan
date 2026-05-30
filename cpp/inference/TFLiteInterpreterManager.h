#pragma once
#include <cstdint>
#include <mutex>
#include <string>
#include <vector>
namespace offlineface::inference {
class TFLiteInterpreterManager {
 public:
  static TFLiteInterpreterManager& Instance();
  void Initialize(const std::string& modelPath);
  std::vector<float> RunEmbedding(const uint8_t* grayPixels, uint32_t width, uint32_t height, uint32_t stride);
  bool IsInitialized() const;
 private:
  TFLiteInterpreterManager() = default;
  std::vector<float> RunMockEmbedding(const uint8_t* grayPixels, uint32_t width, uint32_t height, uint32_t stride) const;
  void ConfigureThreadBudget();
  void CreateDelegates();
  mutable std::mutex mutex_; std::string modelPath_; bool initialized_{false}; bool useNnapi_{false}; bool useXnnpack_{false}; bool useCoreMl_{false}; bool useMetal_{false}; int threadCount_{2};
};
}
