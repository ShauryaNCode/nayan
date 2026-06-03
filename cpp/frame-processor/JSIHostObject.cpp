#include "JSIHostObject.h"

#include <algorithm>
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

JSIHostObject::EmbeddingMutableBuffer::EmbeddingMutableBuffer(
    std::vector<float> embedding)
    : embedding_(std::move(embedding)) {}

size_t JSIHostObject::EmbeddingMutableBuffer::size() const {
  if (processedFrameResult_ != nullptr) {
    return processedFrameResult_->embedding.size() * sizeof(float);
  }
  return embedding_.size() * sizeof(float);
}

uint8_t* JSIHostObject::EmbeddingMutableBuffer::data() {
  if (processedFrameResult_ != nullptr) {
    if (processedFrameResult_->embedding.empty()) {
      return nullptr;
    }
    return reinterpret_cast<uint8_t*>(processedFrameResult_->embedding.data());
  }
  if (embedding_.empty()) {
    return nullptr;
  }
  return reinterpret_cast<uint8_t*>(embedding_.data());
}

JSIHostObject::JSIHostObject(ProcessedFrameResult result)
    : result_(std::make_shared<ProcessedFrameResult>(std::move(result))) {}

JSIHostObject::JSIHostObject(std::shared_ptr<ProcessedFrameResult> result)
    : result_(std::move(result)) {
  if (result_ == nullptr) {
    throw std::invalid_argument("result must not be null");
  }
}

JSIHostObject::JSIHostObject(std::shared_ptr<FrameProcessorPlugin> plugin)
    : plugin_(std::move(plugin)) {
  if (plugin_ == nullptr) {
    throw std::invalid_argument("plugin must not be null");
  }
}

ProcessedFrameResult JSIHostObject::SnapshotResult() const {
  if (plugin_ != nullptr) {
    return plugin_->DrainLatestResult();
  }
  return result_ == nullptr ? ProcessedFrameResult{} : *result_;
}

jsi::Value JSIHostObject::get(jsi::Runtime& rt, const jsi::PropNameID& name) {
  const ProcessedFrameResult snapshot = SnapshotResult();
  const std::string propertyName = name.utf8(rt);
  if (propertyName == "accepted") {
    return jsi::Value(snapshot.accepted);
  }
  if (propertyName == "externalModelProcessed") {
    return jsi::Value(snapshot.externalModelProcessed);
  }
  if (propertyName == "timestampNs") {
    return jsi::Value(static_cast<double>(snapshot.timestampNs));
  }
  if (propertyName == "sharpnessScore") {
    return jsi::Value(static_cast<double>(snapshot.sharpnessScore));
  }
  if (propertyName == "faceMeshProcessed") {
    return jsi::Value(snapshot.faceMeshProcessed);
  }
  if (propertyName == "mobileFaceNetProcessed") {
    return jsi::Value(snapshot.mobileFaceNetProcessed);
  }
  if (propertyName == "droppedFrameCount") {
    return jsi::Value(static_cast<double>(snapshot.droppedFrameCount));
  }
  if (propertyName == "replacedFrameCount") {
    return jsi::Value(static_cast<double>(snapshot.replacedFrameCount));
  }
  if (propertyName == "faceMeshThreadCount") {
    return jsi::Value(static_cast<double>(snapshot.faceMeshThreadCount));
  }
  if (propertyName == "mobileFaceNetThreadCount") {
    return jsi::Value(static_cast<double>(snapshot.mobileFaceNetThreadCount));
  }
  if (propertyName == "livenessState") {
    return jsi::Value(
        static_cast<double>(static_cast<int>(snapshot.livenessState)));
  }
  if (propertyName == "livenessChallenge") {
    return jsi::Value(
        static_cast<double>(static_cast<int>(snapshot.livenessChallenge)));
  }
  if (propertyName == "faceDetected") {
    return jsi::Value(snapshot.faceDetected);
  }
  if (propertyName == "ear") {
    return jsi::Value(static_cast<double>(snapshot.ear));
  }
  if (propertyName == "mar") {
    return jsi::Value(static_cast<double>(snapshot.mar));
  }
  if (propertyName == "yaw") {
    return jsi::Value(static_cast<double>(snapshot.yaw));
  }
  if (propertyName == "pitch") {
    return jsi::Value(static_cast<double>(snapshot.pitch));
  }
  if (propertyName == "roll") {
    return jsi::Value(static_cast<double>(snapshot.roll));
  }
  if (propertyName == "inferenceMs") {
    return jsi::Value(static_cast<double>(snapshot.inferenceMs));
  }
  if (propertyName == "ramMb") {
    return jsi::Value(static_cast<double>(snapshot.ramMb));
  }
  if (propertyName == "fftHighFrequencyRatio") {
    return jsi::Value(static_cast<double>(snapshot.fftHighFrequencyRatio));
  }
  if (propertyName == "fftMoireScore") {
    return jsi::Value(static_cast<double>(snapshot.fftMoireScore));
  }
  if (propertyName == "passiveTextureOk") {
    return jsi::Value(snapshot.passiveTextureOk);
  }
  if (propertyName == "passiveDepthOk") {
    return jsi::Value(snapshot.passiveDepthOk);
  }
  if (propertyName == "passiveDepthRatio") {
    return jsi::Value(static_cast<double>(snapshot.passiveDepthRatio));
  }
  if (propertyName == "framesProcessed") {
    return jsi::Value(static_cast<double>(snapshot.framesProcessed));
  }
  if (propertyName == "framesWithFace") {
    return jsi::Value(static_cast<double>(snapshot.framesWithFace));
  }
  if (propertyName == "embeddingValid") {
    return jsi::Value(snapshot.embeddingValid);
  }
  if (propertyName == "embeddingFrameId") {
    return jsi::Value(static_cast<double>(snapshot.embeddingFrameId));
  }
  if (propertyName == "embedding") {
    return jsi::Value(rt, CreateEmbeddingTypedArray(rt, snapshot));
  }
  if (propertyName == "embeddingPreview") {
    const size_t previewSize = std::min<size_t>(snapshot.embedding.size(), 8U);
    jsi::Array preview(rt, previewSize);
    for (size_t i = 0; i < previewSize; ++i) {
      preview.setValueAtIndex(rt, i, jsi::Value(static_cast<double>(snapshot.embedding[i])));
    }
    return jsi::Value(rt, std::move(preview));
  }
  if (propertyName == "embeddingLength") {
    return jsi::Value(static_cast<double>(snapshot.embedding.size()));
  }
  if (propertyName == "embeddingByteLength") {
    return jsi::Value(
        static_cast<double>(snapshot.embedding.size() * sizeof(float)));
  }
  return jsi::Value::undefined();
}

std::vector<jsi::PropNameID> JSIHostObject::getPropertyNames(jsi::Runtime& rt) {
  std::vector<jsi::PropNameID> names;
  names.reserve(34);
  names.emplace_back(jsi::PropNameID::forAscii(rt, "accepted"));
  names.emplace_back(jsi::PropNameID::forAscii(rt, "externalModelProcessed"));
  names.emplace_back(jsi::PropNameID::forAscii(rt, "timestampNs"));
  names.emplace_back(jsi::PropNameID::forAscii(rt, "sharpnessScore"));
  names.emplace_back(jsi::PropNameID::forAscii(rt, "faceMeshProcessed"));
  names.emplace_back(jsi::PropNameID::forAscii(rt, "mobileFaceNetProcessed"));
  names.emplace_back(jsi::PropNameID::forAscii(rt, "droppedFrameCount"));
  names.emplace_back(jsi::PropNameID::forAscii(rt, "replacedFrameCount"));
  names.emplace_back(jsi::PropNameID::forAscii(rt, "faceMeshThreadCount"));
  names.emplace_back(jsi::PropNameID::forAscii(rt, "mobileFaceNetThreadCount"));
  names.emplace_back(jsi::PropNameID::forAscii(rt, "livenessState"));
  names.emplace_back(jsi::PropNameID::forAscii(rt, "livenessChallenge"));
  names.emplace_back(jsi::PropNameID::forAscii(rt, "faceDetected"));
  names.emplace_back(jsi::PropNameID::forAscii(rt, "ear"));
  names.emplace_back(jsi::PropNameID::forAscii(rt, "mar"));
  names.emplace_back(jsi::PropNameID::forAscii(rt, "yaw"));
  names.emplace_back(jsi::PropNameID::forAscii(rt, "pitch"));
  names.emplace_back(jsi::PropNameID::forAscii(rt, "roll"));
  names.emplace_back(jsi::PropNameID::forAscii(rt, "inferenceMs"));
  names.emplace_back(jsi::PropNameID::forAscii(rt, "ramMb"));
  names.emplace_back(jsi::PropNameID::forAscii(rt, "fftHighFrequencyRatio"));
  names.emplace_back(jsi::PropNameID::forAscii(rt, "fftMoireScore"));
  names.emplace_back(jsi::PropNameID::forAscii(rt, "passiveTextureOk"));
  names.emplace_back(jsi::PropNameID::forAscii(rt, "passiveDepthOk"));
  names.emplace_back(jsi::PropNameID::forAscii(rt, "passiveDepthRatio"));
  names.emplace_back(jsi::PropNameID::forAscii(rt, "framesProcessed"));
  names.emplace_back(jsi::PropNameID::forAscii(rt, "framesWithFace"));
  names.emplace_back(jsi::PropNameID::forAscii(rt, "embeddingValid"));
  names.emplace_back(jsi::PropNameID::forAscii(rt, "embeddingFrameId"));
  names.emplace_back(jsi::PropNameID::forAscii(rt, "embedding"));
  names.emplace_back(jsi::PropNameID::forAscii(rt, "embeddingPreview"));
  names.emplace_back(jsi::PropNameID::forAscii(rt, "embeddingLength"));
  names.emplace_back(jsi::PropNameID::forAscii(rt, "embeddingByteLength"));
  return names;
}

jsi::Object JSIHostObject::CreateEmbeddingTypedArray(
    jsi::Runtime& rt,
    const ProcessedFrameResult& snapshot) const {
  std::lock_guard<std::mutex> lock(embeddingMutex_);
  if (plugin_ != nullptr) {
    if (embeddingBuffer_ == nullptr ||
        embeddingBufferFrameId_ != snapshot.embeddingFrameId) {
      embeddingBuffer_ =
          std::make_shared<EmbeddingMutableBuffer>(snapshot.embedding);
      embeddingBufferFrameId_ = snapshot.embeddingFrameId;
    }
  } else if (embeddingBuffer_ == nullptr) {
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
          jsi::Value(static_cast<double>(snapshot.embedding.size())))
      .asObject(rt);
}

std::shared_ptr<jsi::HostObject> MakeResultHostObject(
    ProcessedFrameResult result) {
  return std::make_shared<JSIHostObject>(std::move(result));
}

std::shared_ptr<jsi::HostObject> MakeLiveResultHostObject(
    std::shared_ptr<FrameProcessorPlugin> plugin) {
  return std::make_shared<JSIHostObject>(std::move(plugin));
}

}  // namespace offlineface::frameprocessor
