#pragma once
#include <atomic>
#include <cstdint>
#include <functional>
#include <memory>
#include <mutex>
#include <vector>
#include "PixelBufferPool.h"
namespace offlineface::clahe { class CLAHEEngine; }
namespace offlineface::inference { class EmbeddingAverager; class TFLiteInterpreterManager; }
namespace offlineface::frameprocessor {
struct ProcessedFrameResult { bool accepted{false}; uint64_t timestampNs{0}; std::vector<float> embedding; float sharpnessScore{0.0f}; };
class FrameProcessorPlugin {
 public:
  FrameProcessorPlugin(std::shared_ptr<PixelBufferPool> pool, std::shared_ptr<offlineface::clahe::CLAHEEngine> claheEngine, std::shared_ptr<offlineface::inference::TFLiteInterpreterManager> interpreterManager, std::shared_ptr<offlineface::inference::EmbeddingAverager> embeddingAverager);
  ~FrameProcessorPlugin();
  bool EnqueueGrayFrame(const uint8_t* source, uint32_t width, uint32_t height, uint32_t stride, uint64_t timestampNs);
#if defined(__APPLE__)
  bool EnqueueAppleLumaPlane(const void* pixelBufferRef, uint32_t width, uint32_t height, uint32_t stride, uint64_t timestampNs);
#endif
  ProcessedFrameResult DrainLatestResult();
  void SetInferenceCallback(std::function<void(const ProcessedFrameResult&)> callback);
 private:
  bool SubmitFrameCopy(const uint8_t* source, uint32_t width, uint32_t height, uint32_t stride, uint64_t timestampNs, PixelFormat format);
  void ProcessCurrentFrame(FrameBuffer* frame);
  float ComputeSharpness(const uint8_t* pixels, uint32_t width, uint32_t height, uint32_t stride) const;
  std::shared_ptr<PixelBufferPool> pool_; std::shared_ptr<offlineface::clahe::CLAHEEngine> claheEngine_; std::shared_ptr<offlineface::inference::TFLiteInterpreterManager> interpreterManager_; std::shared_ptr<offlineface::inference::EmbeddingAverager> embeddingAverager_;
  std::atomic<FrameBuffer*> mailbox_{nullptr}; std::atomic<bool> isProcessing_{false}; std::mutex resultMutex_; ProcessedFrameResult latestResult_{}; std::function<void(const ProcessedFrameResult&)> callback_;
};
}
