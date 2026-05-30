#include "JSIHostObject.h"

#include <string>
#include <stdexcept>
#include <utility>

namespace jsi = facebook::jsi;

namespace offlineface::frameprocessor {

JSIHostObject::EmbeddingMutableBuffer::EmbeddingMutableBuffer(
    std::shared_ptr<ProcessedFrameResult> processedFrameResult)
    : processedFrameResult_(std::move(processedFrameResult)) {
  if (processedFrameResult_ == nullptr) {
    throw std::invalid_argument("processedFrameResult must not be null");
  }
}

size_t JSIHostObject::EmbeddingMutableBuffer::size() const {
  return processedFrameResult_->embedding.size() * sizeof(float);
}

uint8_t* JSIHostObject::EmbeddingMutableBuffer::data() {
  if (processedFrameResult_->embedding.empty()) {
    return nullptr;
  }
  return reinterpret_cast<uint8_t*>(processedFrameResult_->embedding.data());
}

JSIHostObject::JSIHostObject(ProcessedFrameResult result)
    : result_(std::make_shared<ProcessedFrameResult>(std::move(result))) {}

JSIHostObject::JSIHostObject(std::shared_ptr<ProcessedFrameResult> result)
    : result_(std::move(result)) {
  if (result_ == nullptr) {
    throw std::invalid_argument("result must not be null");
  }
}

jsi::Value JSIHostObject::get(jsi::Runtime& rt, const jsi::PropNameID& name) {
  const std::string propertyName = name.utf8(rt);
  if (propertyName == "accepted") {
    return jsi::Value(result_->accepted);
  }
  if (propertyName == "timestampNs") {
    return jsi::Value(static_cast<double>(result_->timestampNs));
  }
  if (propertyName == "sharpnessScore") {
    return jsi::Value(static_cast<double>(result_->sharpnessScore));
  }
  if (propertyName == "embedding") {
    return jsi::Value(rt, CreateEmbeddingTypedArray(rt));
  }
  if (propertyName == "embeddingLength") {
    return jsi::Value(static_cast<double>(result_->embedding.size()));
  }
  if (propertyName == "embeddingByteLength") {
    return jsi::Value(
        static_cast<double>(result_->embedding.size() * sizeof(float)));
  }
  return jsi::Value::undefined();
}

std::vector<jsi::PropNameID> JSIHostObject::getPropertyNames(jsi::Runtime& rt) {
  std::vector<jsi::PropNameID> names;
  names.reserve(6);
  names.emplace_back(jsi::PropNameID::forAscii(rt, "accepted"));
  names.emplace_back(jsi::PropNameID::forAscii(rt, "timestampNs"));
  names.emplace_back(jsi::PropNameID::forAscii(rt, "sharpnessScore"));
  names.emplace_back(jsi::PropNameID::forAscii(rt, "embedding"));
  names.emplace_back(jsi::PropNameID::forAscii(rt, "embeddingLength"));
  names.emplace_back(jsi::PropNameID::forAscii(rt, "embeddingByteLength"));
  return names;
}

jsi::Object JSIHostObject::CreateEmbeddingTypedArray(jsi::Runtime& rt) const {
  std::lock_guard<std::mutex> lock(embeddingMutex_);
  if (embeddingBuffer_ == nullptr) {
    embeddingBuffer_ = std::make_shared<EmbeddingMutableBuffer>(result_);
  }

  jsi::ArrayBuffer arrayBuffer(rt, embeddingBuffer_);
  jsi::Function float32ArrayCtor =
      rt.global().getPropertyAsFunction(rt, "Float32Array");
  return float32ArrayCtor
      .callAsConstructor(
          rt,
          jsi::Value(rt, std::move(arrayBuffer)),
          jsi::Value(0.0),
          jsi::Value(static_cast<double>(result_->embedding.size())))
      .asObject(rt);
}

std::shared_ptr<jsi::HostObject> MakeResultHostObject(
    ProcessedFrameResult result) {
  return std::make_shared<JSIHostObject>(std::move(result));
}

}  // namespace offlineface::frameprocessor
