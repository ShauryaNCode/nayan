#pragma once
#include <atomic>
#include <condition_variable>
#include <cstdint>
#include <functional>
#include <memory>
#include <mutex>
#include <thread>
#include <vector>
#include "PixelBufferPool.h"
namespace offlineface::clahe { class CLAHEEngine; }
namespace offlineface::inference { class EmbeddingAverager; class TFLiteInterpreterManager; }
namespace offlineface::frameprocessor {

enum class NativeLivenessState : uint8_t {
  kIdle = 0,
  kDetected = 1,
  kChallengeActive = 2,
  kLivenessPass = 3,
  kLivenessFail = 4,
};

struct ProcessedFrameResult {
  bool accepted{false};
  bool faceMeshProcessed{false};
  bool mobileFaceNetProcessed{false};
  uint64_t timestampNs{0};
  uint64_t droppedFrameCount{0};
  uint64_t replacedFrameCount{0};
  int faceMeshThreadCount{2};
  int mobileFaceNetThreadCount{2};
  NativeLivenessState livenessState{NativeLivenessState::kIdle};
  std::vector<float> embedding;
  float sharpnessScore{0.0f};
};

class FrameProcessorPlugin {
 public:
  FrameProcessorPlugin(std::shared_ptr<PixelBufferPool> pool, std::shared_ptr<offlineface::clahe::CLAHEEngine> claheEngine, std::shared_ptr<offlineface::inference::TFLiteInterpreterManager> interpreterManager, std::shared_ptr<offlineface::inference::EmbeddingAverager> embeddingAverager);
  ~FrameProcessorPlugin();
  FrameProcessorPlugin(const FrameProcessorPlugin&) = delete;
  FrameProcessorPlugin& operator=(const FrameProcessorPlugin&) = delete;
  bool EnqueueGrayFrame(const uint8_t* source, uint32_t width, uint32_t height, uint32_t stride, uint64_t timestampNs);
#if defined(__APPLE__)
  bool EnqueueAppleLumaPlane(const void* pixelBufferRef, uint32_t width, uint32_t height, uint32_t stride, uint64_t timestampNs);
#endif
  ProcessedFrameResult DrainLatestResult();
  void SetInferenceCallback(std::function<void(const ProcessedFrameResult&)> callback);
  void SetLivenessState(NativeLivenessState state);
 private:
  bool SubmitFrameCopy(const uint8_t* source, uint32_t width, uint32_t height, uint32_t stride, uint64_t timestampNs, PixelFormat format);
  void InferenceLoop();
  void ProcessCurrentFrame(FrameBuffer* frame);
  NativeLivenessState GetLivenessState() const;
  bool ShouldRunMobileFaceNet() const;
  float ComputeSharpness(const uint8_t* pixels, uint32_t width, uint32_t height, uint32_t stride) const;
  std::shared_ptr<PixelBufferPool> pool_; std::shared_ptr<offlineface::clahe::CLAHEEngine> claheEngine_; std::shared_ptr<offlineface::inference::TFLiteInterpreterManager> interpreterManager_; std::shared_ptr<offlineface::inference::EmbeddingAverager> embeddingAverager_;
  std::atomic<FrameBuffer*> mailbox_{nullptr};
  std::atomic<bool> running_{false};
  std::atomic<int> livenessState_{static_cast<int>(NativeLivenessState::kIdle)};
  std::atomic<uint64_t> droppedFrameCount_{0};
  std::atomic<uint64_t> replacedFrameCount_{0};
  std::condition_variable mailboxCv_;
  std::mutex mailboxMutex_;
  std::thread inferenceThread_;
  std::mutex resultMutex_;
  std::mutex callbackMutex_;
  ProcessedFrameResult latestResult_{};
  std::function<void(const ProcessedFrameResult&)> callback_;
};
}
