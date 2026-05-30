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

  facebook::jsi::Value get(facebook::jsi::Runtime& rt,
                           const facebook::jsi::PropNameID& name) override;
  std::vector<facebook::jsi::PropNameID> getPropertyNames(
      facebook::jsi::Runtime& rt) override;

 private:
  class EmbeddingMutableBuffer final : public facebook::jsi::MutableBuffer {
   public:
    explicit EmbeddingMutableBuffer(
        std::shared_ptr<ProcessedFrameResult> processedFrameResult);

    size_t size() const override;
    uint8_t* data() override;

   private:
    std::shared_ptr<ProcessedFrameResult> processedFrameResult_;
  };

  facebook::jsi::Object CreateEmbeddingTypedArray(
      facebook::jsi::Runtime& rt) const;

  std::shared_ptr<ProcessedFrameResult> result_;
  mutable std::mutex embeddingMutex_;
  mutable std::shared_ptr<facebook::jsi::MutableBuffer> embeddingBuffer_;
};

std::shared_ptr<facebook::jsi::HostObject> MakeResultHostObject(
    ProcessedFrameResult result);

}  // namespace offlineface::frameprocessor
