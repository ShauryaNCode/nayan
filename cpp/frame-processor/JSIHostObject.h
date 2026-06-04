#pragma once

#include <jsi/jsi.h>

#include <memory>
#include <mutex>
#include <vector>

#include "FrameProcessorPlugin.h"

namespace offlineface::frameprocessor {

class JSIHostObject final : public facebook::jsi::HostObject {
 public:
  explicit JSIHostObject(ProcessedFrameResult result);
  explicit JSIHostObject(std::shared_ptr<ProcessedFrameResult> result);
  explicit JSIHostObject(std::shared_ptr<FrameProcessorPlugin> plugin);

  facebook::jsi::Value get(facebook::jsi::Runtime& rt,
                           const facebook::jsi::PropNameID& name) override;
  std::vector<facebook::jsi::PropNameID> getPropertyNames(
      facebook::jsi::Runtime& rt) override;

 private:
  class EmbeddingMutableBuffer final : public facebook::jsi::MutableBuffer {
   public:
    explicit EmbeddingMutableBuffer(
        std::shared_ptr<ProcessedFrameResult> processedFrameResult);
    explicit EmbeddingMutableBuffer(std::vector<float> embedding);

    size_t size() const override;
    uint8_t* data() override;

   private:
    std::shared_ptr<ProcessedFrameResult> processedFrameResult_;
    std::vector<float> embedding_;
  };

  facebook::jsi::Object CreateEmbeddingTypedArray(
      facebook::jsi::Runtime& rt,
      const ProcessedFrameResult& snapshot) const;
  ProcessedFrameResult SnapshotResult() const;

  std::shared_ptr<ProcessedFrameResult> result_;
  std::shared_ptr<FrameProcessorPlugin> plugin_;
  mutable std::mutex embeddingMutex_;
  mutable std::shared_ptr<facebook::jsi::MutableBuffer> embeddingBuffer_;
  mutable uint64_t embeddingBufferFrameId_{0};
};

std::shared_ptr<facebook::jsi::HostObject> MakeResultHostObject(
    ProcessedFrameResult result);
std::shared_ptr<facebook::jsi::HostObject> MakeLiveResultHostObject(
    std::shared_ptr<FrameProcessorPlugin> plugin);

}  // namespace offlineface::frameprocessor
