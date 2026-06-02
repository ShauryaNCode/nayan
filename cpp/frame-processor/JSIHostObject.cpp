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
  if (propertyName == "externalModelProcessed") {
    return jsi::Value(result_->externalModelProcessed);
  }
  if (propertyName == "timestampNs") {
    return jsi::Value(static_cast<double>(result_->timestampNs));
  }
  if (propertyName == "sharpnessScore") {
    return jsi::Value(static_cast<double>(result_->sharpnessScore));
  }
  if (propertyName == "faceMeshProcessed") {
    return jsi::Value(result_->faceMeshProcessed);
  }
  if (propertyName == "mobileFaceNetProcessed") {
    return jsi::Value(result_->mobileFaceNetProcessed);
  }
  if (propertyName == "droppedFrameCount") {
    return jsi::Value(static_cast<double>(result_->droppedFrameCount));
  }
  if (propertyName == "replacedFrameCount") {
    return jsi::Value(static_cast<double>(result_->replacedFrameCount));
  }
  if (propertyName == "faceMeshThreadCount") {
    return jsi::Value(static_cast<double>(result_->faceMeshThreadCount));
  }
  if (propertyName == "mobileFaceNetThreadCount") {
    return jsi::Value(static_cast<double>(result_->mobileFaceNetThreadCount));
  }
  if (propertyName == "livenessState") {
    return jsi::Value(
        static_cast<double>(static_cast<int>(result_->livenessState)));
  }
  if (propertyName == "livenessChallenge") {
    return jsi::Value(
        static_cast<double>(static_cast<int>(result_->livenessChallenge)));
  }
  if (propertyName == "faceDetected") {
    return jsi::Value(result_->faceDetected);
  }
  if (propertyName == "ear") {
    return jsi::Value(static_cast<double>(result_->ear));
  }
  if (propertyName == "mar") {
    return jsi::Value(static_cast<double>(result_->mar));
  }
  if (propertyName == "yaw") {
    return jsi::Value(static_cast<double>(result_->yaw));
  }
  if (propertyName == "pitch") {
    return jsi::Value(static_cast<double>(result_->pitch));
  }
  if (propertyName == "roll") {
    return jsi::Value(static_cast<double>(result_->roll));
  }
  if (propertyName == "inferenceMs") {
    return jsi::Value(static_cast<double>(result_->inferenceMs));
  }
  if (propertyName == "ramMb") {
    return jsi::Value(static_cast<double>(result_->ramMb));
  }
  if (propertyName == "fftHighFrequencyRatio") {
    return jsi::Value(static_cast<double>(result_->fftHighFrequencyRatio));
  }
  if (propertyName == "fftMoireScore") {
    return jsi::Value(static_cast<double>(result_->fftMoireScore));
  }
  if (propertyName == "passiveTextureOk") {
    return jsi::Value(result_->passiveTextureOk);
  }
  if (propertyName == "passiveDepthOk") {
    return jsi::Value(result_->passiveDepthOk);
  }
  if (propertyName == "passiveDepthRatio") {
    return jsi::Value(static_cast<double>(result_->passiveDepthRatio));
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
  names.reserve(20);
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
