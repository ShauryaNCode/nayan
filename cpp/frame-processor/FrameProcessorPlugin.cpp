#include "FrameProcessorPlugin.h"

#include <algorithm>
#include <chrono>
#include <cstring>
#include <stdexcept>
#include <utility>

#if defined(__APPLE__)
#include <CoreVideo/CoreVideo.h>
#endif
#if defined(__ANDROID__)
#include <malloc.h>
#endif

#include "../clahe/CLAHEEngine.h"
#include "../clahe/ColorSpaceConverter.h"
#include "../antispoof/DepthCueChecker.h"
#include "../antispoof/FFTTextureAnalyzer.h"
#include "../common/MathUtils.h"
#include "../inference/EmbeddingAverager.h"
#include "../inference/TFLiteInterpreterManager.h"

namespace offlineface::frameprocessor {
namespace {
using namespace std::chrono_literals;
using Clock = std::chrono::steady_clock;

float CurrentHeapUsageMb() {
#if defined(__ANDROID__) && __ANDROID_API__ >= 31
  const struct mallinfo2 info = mallinfo2();
  return static_cast<float>(info.uordblks) / (1024.0f * 1024.0f);
#elif defined(__ANDROID__)
  const struct mallinfo info = mallinfo();
  return static_cast<float>(info.uordblks) / (1024.0f * 1024.0f);
#else
  return 0.0f;
#endif
}
}

FrameProcessorPlugin::FrameProcessorPlugin(
    std::shared_ptr<PixelBufferPool> pool,
    std::shared_ptr<offlineface::clahe::CLAHEEngine> claheEngine,
    std::shared_ptr<offlineface::inference::TFLiteInterpreterManager>
        interpreterManager,
    std::shared_ptr<offlineface::inference::EmbeddingAverager>
        embeddingAverager)
    : pool_(std::move(pool)),
      claheEngine_(std::move(claheEngine)),
      interpreterManager_(std::move(interpreterManager)),
      embeddingAverager_(std::move(embeddingAverager)) {
  if (!pool_ || !claheEngine_ || !interpreterManager_ || !embeddingAverager_) {
    throw std::invalid_argument(
        "FrameProcessorPlugin dependencies must not be null");
  }

  running_.store(true, std::memory_order_release);
  inferenceThread_ = std::thread(&FrameProcessorPlugin::InferenceLoop, this);
}

FrameProcessorPlugin::~FrameProcessorPlugin() {
  running_.store(false, std::memory_order_release);
  mailboxCv_.notify_one();

  if (inferenceThread_.joinable()) {
    inferenceThread_.join();
  }

  FrameBuffer* pending = mailbox_.exchange(nullptr, std::memory_order_acq_rel);
  if (pending != nullptr) {
    pool_->Release(pending);
  }
}

bool FrameProcessorPlugin::EnqueueGrayFrame(const uint8_t* source,
                                            uint32_t width,
                                            uint32_t height,
                                            uint32_t stride,
                                            uint64_t timestampNs) {
  if (source == nullptr || width == 0U || height == 0U || stride < width) {
    return false;
  }

  return SubmitFrameCopy(
      source, width, height, stride, timestampNs, PixelFormat::kGray8);
}

bool FrameProcessorPlugin::SubmitExternalModelResult(
    const float* landmarkValues,
    std::size_t landmarkValueCount,
    const float* embeddingValues,
    std::size_t embeddingValueCount,
    uint32_t width,
    uint32_t height,
    uint64_t timestampNs,
    float externalInferenceMs) {
  if (landmarkValues == nullptr || landmarkValueCount < 468U * 3U ||
      width == 0U || height == 0U) {
    return false;
  }

  const auto faceMeshResult = interpreterManager_->RunFaceMeshLandmarks(
      landmarkValues, landmarkValueCount, width, height);
  const auto depthCueResult = antispoof::CheckDepthCueFromLandmarks(
      landmarkValues, landmarkValueCount, width, height);
  const bool passiveDepthOk = !depthCueResult.faceDetected ||
                              !depthCueResult.spoofDetected;
  const auto startedAt = Clock::now();
  const uint64_t frameId =
      framesProcessed_.fetch_add(1U, std::memory_order_acq_rel) + 1U;

  offlineface::landmarks::FaceMetrics metrics{};
  metrics.faceDetected = faceMeshResult.faceDetected;
  metrics.ear = faceMeshResult.eyeAspectRatio;
  metrics.mar = faceMeshResult.mouthAspectRatio;
  metrics.yaw = faceMeshResult.yawDegrees;
  metrics.pitch = faceMeshResult.pitchDegrees;
  metrics.roll = faceMeshResult.rollDegrees;
  if (faceMeshResult.faceDetected) {
    framesWithFace_.fetch_add(1U, std::memory_order_acq_rel);
  }

  offlineface::landmarks::LivenessSnapshot livenessSnapshot{};
  {
    std::lock_guard<std::mutex> lock(fsmMutex_);
    livenessSnapshot =
        livenessFsm_.Update({metrics, Clock::now(), true, passiveDepthOk});
  }
  livenessState_.store(
      static_cast<int>(ToNativeState(livenessSnapshot.state)),
      std::memory_order_release);

  const bool fsmPassed =
      ToNativeState(livenessSnapshot.state) == NativeLivenessState::kLivenessPass;
  const bool canUseEmbedding =
      embeddingValues != nullptr && embeddingValueCount == 128U &&
      faceMeshResult.faceDetected && fsmPassed &&
      !embeddingWrittenThisSession_.load(std::memory_order_acquire);

  std::vector<float> embedding;
  if (canUseEmbedding) {
    embedding.assign(embeddingValues, embeddingValues + embeddingValueCount);
    offlineface::common::NormalizeL2(embedding.data(), embedding.size());
  }

  std::vector<float> persistentEmbedding;
  bool persistentEmbeddingValid = false;
  uint64_t persistentEmbeddingFrameId = 0;
  {
    std::lock_guard<std::mutex> lock(resultMutex_);
    if (canUseEmbedding && !embedding.empty()) {
      latestEmbedding_ = embeddingAverager_->PushEmbedding(timestampNs, embedding);
      latestEmbeddingValid_ = !latestEmbedding_.empty();
      latestEmbeddingFrameId_ = frameId;
      embeddingWrittenThisSession_.store(
          latestEmbeddingValid_, std::memory_order_release);
    } else if (ToNativeState(livenessSnapshot.state) == NativeLivenessState::kIdle) {
      embeddingWrittenThisSession_.store(false, std::memory_order_release);
    }
    persistentEmbedding = latestEmbedding_;
    persistentEmbeddingValid = latestEmbeddingValid_;
    persistentEmbeddingFrameId = latestEmbeddingFrameId_;
  }

  const auto threadBudget = interpreterManager_->GetThreadBudget();
  ProcessedFrameResult nextResult{};
  nextResult.accepted = persistentEmbeddingValid;
  nextResult.externalModelProcessed = true;
  nextResult.faceMeshProcessed = faceMeshResult.faceDetected;
  nextResult.mobileFaceNetProcessed = canUseEmbedding || persistentEmbeddingValid;
  nextResult.timestampNs = timestampNs;
  nextResult.droppedFrameCount =
      droppedFrameCount_.load(std::memory_order_acquire);
  nextResult.replacedFrameCount =
      replacedFrameCount_.load(std::memory_order_acquire);
  nextResult.faceMeshThreadCount = threadBudget.faceMeshThreads;
  nextResult.mobileFaceNetThreadCount = threadBudget.mobileFaceNetThreads;
  nextResult.livenessState = ToNativeState(livenessSnapshot.state);
  nextResult.livenessChallenge = static_cast<NativeLivenessChallenge>(
      static_cast<int>(livenessSnapshot.challenge));
  nextResult.faceDetected = faceMeshResult.faceDetected;
  nextResult.ear = faceMeshResult.eyeAspectRatio;
  nextResult.mar = faceMeshResult.mouthAspectRatio;
  nextResult.yaw = faceMeshResult.yawDegrees;
  nextResult.pitch = faceMeshResult.pitchDegrees;
  nextResult.roll = faceMeshResult.rollDegrees;
  nextResult.inferenceMs =
      std::max(0.0f, externalInferenceMs) +
      std::chrono::duration<float, std::milli>(Clock::now() - startedAt).count();
  nextResult.ramMb = CurrentHeapUsageMb();
  nextResult.passiveTextureOk = true;
  nextResult.passiveDepthOk = passiveDepthOk;
  nextResult.passiveDepthRatio = depthCueResult.faceBoxToEyeRatio;
  nextResult.framesProcessed =
      framesProcessed_.load(std::memory_order_acquire);
  nextResult.framesWithFace =
      framesWithFace_.load(std::memory_order_acquire);
  nextResult.embeddingValid = persistentEmbeddingValid;
  nextResult.embeddingFrameId = persistentEmbeddingFrameId;
  nextResult.embedding = std::move(persistentEmbedding);
  nextResult.sharpnessScore = 0.0f;

  {
    std::lock_guard<std::mutex> lock(resultMutex_);
    latestResult_ = nextResult;
  }

  std::function<void(const ProcessedFrameResult&)> callback;
  {
    std::lock_guard<std::mutex> lock(callbackMutex_);
    callback = callback_;
  }
  if (callback) {
    callback(nextResult);
  }

  return true;
}

#if defined(__APPLE__)
bool FrameProcessorPlugin::EnqueueAppleLumaPlane(const void* pixelBufferRef,
                                                 uint32_t width,
                                                 uint32_t height,
                                                 uint32_t stride,
                                                 uint64_t timestampNs) {
  if (pixelBufferRef == nullptr) {
    return false;
  }

  CVPixelBufferRef buffer =
      static_cast<CVPixelBufferRef>(const_cast<void*>(pixelBufferRef));
  const CVReturn lockResult =
      CVPixelBufferLockBaseAddress(buffer, kCVPixelBufferLock_ReadOnly);
  if (lockResult != kCVReturnSuccess) {
    return false;
  }

  const auto* yPlane =
      static_cast<const uint8_t*>(CVPixelBufferGetBaseAddressOfPlane(buffer, 0));
  const size_t planeStride = CVPixelBufferGetBytesPerRowOfPlane(buffer, 0);
  const size_t planeHeight = CVPixelBufferGetHeightOfPlane(buffer, 0);
  const bool success = SubmitFrameCopy(
      yPlane,
      width,
      static_cast<uint32_t>(planeHeight),
      static_cast<uint32_t>(planeStride),
      timestampNs,
      PixelFormat::kNv12YPlane);
  CVPixelBufferUnlockBaseAddress(buffer, kCVPixelBufferLock_ReadOnly);
  return success;
}
#endif

ProcessedFrameResult FrameProcessorPlugin::DrainLatestResult() {
  std::lock_guard<std::mutex> lock(resultMutex_);
  return latestResult_;
}

void FrameProcessorPlugin::SetInferenceCallback(
    std::function<void(const ProcessedFrameResult&)> callback) {
  std::lock_guard<std::mutex> lock(callbackMutex_);
  callback_ = std::move(callback);
}

void FrameProcessorPlugin::SetLivenessState(NativeLivenessState state) {
  if (state == NativeLivenessState::kLivenessPass) {
    std::lock_guard<std::mutex> lock(fsmMutex_);
    livenessFsm_.ForcePass("manual phase 1 verification pass");
  } else if (state == NativeLivenessState::kIdle) {
    std::lock_guard<std::mutex> lock(fsmMutex_);
    livenessFsm_.Reset();
    std::lock_guard<std::mutex> resultLock(resultMutex_);
    latestEmbedding_.clear();
    latestEmbeddingValid_ = false;
    latestEmbeddingFrameId_ = 0;
    latestResult_.accepted = false;
    latestResult_.embeddingValid = false;
    latestResult_.embeddingFrameId = 0;
    latestResult_.embedding.clear();
    latestResult_.mobileFaceNetProcessed = false;
    embeddingWrittenThisSession_.store(false, std::memory_order_release);
  }
  livenessState_.store(static_cast<int>(state), std::memory_order_release);
}

void FrameProcessorPlugin::SetLivenessChallenge(
    NativeLivenessChallenge challenge) {
  std::lock_guard<std::mutex> lock(fsmMutex_);
  if (challenge == NativeLivenessChallenge::kNone) {
    livenessFsm_.Reset();
    {
      std::lock_guard<std::mutex> resultLock(resultMutex_);
      latestEmbedding_.clear();
      latestEmbeddingValid_ = false;
      latestEmbeddingFrameId_ = 0;
      latestResult_.accepted = false;
      latestResult_.embeddingValid = false;
      latestResult_.embeddingFrameId = 0;
      latestResult_.embedding.clear();
      latestResult_.mobileFaceNetProcessed = false;
      embeddingWrittenThisSession_.store(false, std::memory_order_release);
    }
    livenessState_.store(
        static_cast<int>(NativeLivenessState::kIdle),
        std::memory_order_release);
    return;
  }

  livenessFsm_.StartChallenge(ToFSMChallenge(challenge));
  {
    std::lock_guard<std::mutex> resultLock(resultMutex_);
    latestEmbedding_.clear();
    latestEmbeddingValid_ = false;
    latestEmbeddingFrameId_ = 0;
    latestResult_.accepted = false;
    latestResult_.embeddingValid = false;
    latestResult_.embeddingFrameId = 0;
    latestResult_.embedding.clear();
    latestResult_.mobileFaceNetProcessed = false;
    embeddingWrittenThisSession_.store(false, std::memory_order_release);
  }
  livenessState_.store(
      static_cast<int>(NativeLivenessState::kChallengeActive),
      std::memory_order_release);
}

bool FrameProcessorPlugin::SubmitFrameCopy(const uint8_t* source,
                                           uint32_t width,
                                           uint32_t height,
                                           uint32_t stride,
                                           uint64_t timestampNs,
                                           PixelFormat format) {
  const std::size_t requiredBytes =
      static_cast<std::size_t>(stride) * static_cast<std::size_t>(height);
  if (isProcessing_.load(std::memory_order_acquire)) {
    droppedFrameCount_.fetch_add(1U, std::memory_order_acq_rel);
    return false;
  }

  FrameBuffer* frame =
      pool_->Acquire(width, height, stride, format, timestampNs, requiredBytes);
  if (frame == nullptr) {
    droppedFrameCount_.fetch_add(1U, std::memory_order_acq_rel);
    return false;
  }

  std::memcpy(frame->data, source, requiredBytes);
  std::atomic_thread_fence(std::memory_order_release);

  FrameBuffer* displaced = mailbox_.exchange(frame, std::memory_order_acq_rel);
  if (displaced != nullptr) {
    replacedFrameCount_.fetch_add(1U, std::memory_order_acq_rel);
    pool_->Release(displaced);
  }

  mailboxCv_.notify_one();
  return true;
}

void FrameProcessorPlugin::InferenceLoop() {
  while (running_.load(std::memory_order_acquire) ||
         mailbox_.load(std::memory_order_acquire) != nullptr) {
    FrameBuffer* current =
        mailbox_.exchange(nullptr, std::memory_order_acq_rel);

    if (current == nullptr) {
      std::unique_lock<std::mutex> lock(mailboxMutex_);
      mailboxCv_.wait_for(lock, 5ms, [this]() {
        return !running_.load(std::memory_order_acquire) ||
               mailbox_.load(std::memory_order_acquire) != nullptr;
      });
      continue;
    }

    isProcessing_.store(true, std::memory_order_release);
    ProcessCurrentFrame(current);
    isProcessing_.store(false, std::memory_order_release);
  }
}

void FrameProcessorPlugin::ProcessCurrentFrame(FrameBuffer* frame) {
  std::atomic_thread_fence(std::memory_order_acquire);
  const uint32_t width = frame->width;
  const uint32_t height = frame->height;
  const uint32_t stride = frame->stride;
  const uint64_t timestampNs = frame->timestampNs;
  const uint64_t frameId =
      framesProcessed_.fetch_add(1U, std::memory_order_acq_rel) + 1U;
  const auto startedAt = Clock::now();

  const std::size_t pixelCount =
      static_cast<std::size_t>(width) * static_cast<std::size_t>(height);
  // Reuse pooled buffers; resize only when frame dimensions change.
  if (width != cachedWidth_ || height != cachedHeight_) {
    cachedWidth_ = width;
    cachedHeight_ = height;
    rgb_.resize(pixelCount * 3U);
    lab_.resize(pixelCount * 3U);
    lChannel_.resize(pixelCount);
    enhancedL_.resize(pixelCount);
    enhancedRgb_.resize(pixelCount * 3U);
    enhanced_.resize(pixelCount);
  }
  std::memset(rgb_.data(), 0, rgb_.size());
  std::fill(lab_.begin(), lab_.end(), 0.0f);
  std::memset(lChannel_.data(), 0, lChannel_.size());
  std::memset(enhancedL_.data(), 0, enhancedL_.size());
  std::memset(enhancedRgb_.data(), 0, enhancedRgb_.size());
  std::memset(enhanced_.data(), 0, enhanced_.size());
  offlineface::clahe::GrayToRgb(
      frame->data, width, height, stride, rgb_.data());
  offlineface::clahe::RgbToLab(rgb_.data(), width, height, lab_.data());
  offlineface::clahe::ExtractLChannel(lab_.data(), width, height, lChannel_.data());
  claheEngine_->Apply(lChannel_.data(), width, height, width, enhancedL_.data());
  offlineface::clahe::ReplaceLChannel(
      enhancedL_.data(), width, height, lab_.data());
  offlineface::clahe::LabToRgb(lab_.data(), width, height, enhancedRgb_.data());
  offlineface::clahe::RgbToGray(enhancedRgb_.data(), width, height, enhanced_.data());

  const auto faceMeshResult =
      interpreterManager_->RunFaceMesh(enhanced_.data(), width, height, width);
  const auto depthCueResult = antispoof::DepthCueResult{};
  const auto fftResult = faceMeshResult.faceDetected
                             ? ::antispoof::AnalyzeFaceCropFixed(
                                   enhanced_.data(),
                                   static_cast<int>(width),
                                   static_cast<int>(height),
                                   static_cast<int>(width))
                             : ::antispoof::FFTTextureResult{};
  offlineface::landmarks::FaceMetrics metrics{};
  metrics.faceDetected = faceMeshResult.faceDetected;
  metrics.ear = faceMeshResult.eyeAspectRatio;
  metrics.mar = faceMeshResult.mouthAspectRatio;
  metrics.yaw = faceMeshResult.yawDegrees;
  metrics.pitch = faceMeshResult.pitchDegrees;
  metrics.roll = faceMeshResult.rollDegrees;
  if (faceMeshResult.faceDetected) {
    framesWithFace_.fetch_add(1U, std::memory_order_acq_rel);
  }

  offlineface::landmarks::LivenessSnapshot livenessSnapshot{};
  {
    std::lock_guard<std::mutex> lock(fsmMutex_);
    livenessSnapshot = livenessFsm_.Update(
        {metrics, Clock::now(), !fftResult.spoofDetected, !depthCueResult.spoofDetected});
  }
  livenessState_.store(
      static_cast<int>(ToNativeState(livenessSnapshot.state)),
      std::memory_order_release);

  const bool runMobileFaceNet =
      faceMeshResult.faceDetected && ShouldRunMobileFaceNet() &&
      !embeddingWrittenThisSession_.load(std::memory_order_acquire);

  std::vector<float> embedding;
  if (runMobileFaceNet) {
    embedding =
        interpreterManager_->RunEmbedding(enhanced_.data(), width, height, width);
  }

  std::vector<float> persistentEmbedding;
  bool persistentEmbeddingValid = false;
  uint64_t persistentEmbeddingFrameId = 0;
  {
    std::lock_guard<std::mutex> lock(resultMutex_);
    if (runMobileFaceNet && !embedding.empty()) {
      latestEmbedding_ = embeddingAverager_->PushEmbedding(timestampNs, embedding);
      latestEmbeddingValid_ = !latestEmbedding_.empty();
      latestEmbeddingFrameId_ = frameId;
      embeddingWrittenThisSession_.store(
          latestEmbeddingValid_, std::memory_order_release);
    } else if (ToNativeState(livenessSnapshot.state) == NativeLivenessState::kIdle) {
      embeddingWrittenThisSession_.store(false, std::memory_order_release);
    }
    persistentEmbedding = latestEmbedding_;
    persistentEmbeddingValid = latestEmbeddingValid_;
    persistentEmbeddingFrameId = latestEmbeddingFrameId_;
  }

  const auto threadBudget = interpreterManager_->GetThreadBudget();
  ProcessedFrameResult nextResult{};
  nextResult.accepted = persistentEmbeddingValid;
  nextResult.externalModelProcessed = false;
  nextResult.faceMeshProcessed = faceMeshResult.faceDetected;
  nextResult.mobileFaceNetProcessed = runMobileFaceNet || persistentEmbeddingValid;
  nextResult.timestampNs = timestampNs;
  nextResult.droppedFrameCount =
      droppedFrameCount_.load(std::memory_order_acquire);
  nextResult.replacedFrameCount =
      replacedFrameCount_.load(std::memory_order_acquire);
  nextResult.faceMeshThreadCount = threadBudget.faceMeshThreads;
  nextResult.mobileFaceNetThreadCount = threadBudget.mobileFaceNetThreads;
  nextResult.livenessState = ToNativeState(livenessSnapshot.state);
  nextResult.livenessChallenge =
      static_cast<NativeLivenessChallenge>(
          static_cast<int>(livenessSnapshot.challenge));
  nextResult.faceDetected = faceMeshResult.faceDetected;
  nextResult.ear = faceMeshResult.eyeAspectRatio;
  nextResult.mar = faceMeshResult.mouthAspectRatio;
  nextResult.yaw = faceMeshResult.yawDegrees;
  nextResult.pitch = faceMeshResult.pitchDegrees;
  nextResult.roll = faceMeshResult.rollDegrees;
  nextResult.inferenceMs =
      std::chrono::duration<float, std::milli>(Clock::now() - startedAt).count();
  nextResult.ramMb = CurrentHeapUsageMb();
  nextResult.fftHighFrequencyRatio =
      static_cast<float>(fftResult.highFrequencyRatioQ10) / 1024.0f;
  nextResult.fftMoireScore =
      static_cast<float>(fftResult.moireScoreQ10) / 1024.0f;
  nextResult.passiveTextureOk = !fftResult.spoofDetected;
  nextResult.passiveDepthOk = !depthCueResult.spoofDetected;
  nextResult.passiveDepthRatio = depthCueResult.faceBoxToEyeRatio;
  nextResult.framesProcessed =
      framesProcessed_.load(std::memory_order_acquire);
  nextResult.framesWithFace =
      framesWithFace_.load(std::memory_order_acquire);
  nextResult.embeddingValid = persistentEmbeddingValid;
  nextResult.embeddingFrameId = persistentEmbeddingFrameId;
  nextResult.embedding = std::move(persistentEmbedding);
  nextResult.sharpnessScore =
      ComputeSharpness(enhanced_.data(), width, height, width);

  {
    std::lock_guard<std::mutex> lock(resultMutex_);
    latestResult_ = nextResult;
  }

  std::function<void(const ProcessedFrameResult&)> callback;
  {
    std::lock_guard<std::mutex> lock(callbackMutex_);
    callback = callback_;
  }
  if (callback) {
    callback(nextResult);
  }

  pool_->Release(frame);
}

NativeLivenessState FrameProcessorPlugin::GetLivenessState() const {
  return static_cast<NativeLivenessState>(
      livenessState_.load(std::memory_order_acquire));
}

NativeLivenessChallenge FrameProcessorPlugin::GetLivenessChallenge() const {
  std::lock_guard<std::mutex> lock(fsmMutex_);
  return static_cast<NativeLivenessChallenge>(
      static_cast<int>(livenessFsm_.Challenge()));
}

bool FrameProcessorPlugin::ShouldRunMobileFaceNet() const {
  return GetLivenessState() == NativeLivenessState::kLivenessPass;
}

NativeLivenessState FrameProcessorPlugin::ToNativeState(
    offlineface::landmarks::LivenessState state) {
  switch (state) {
    case offlineface::landmarks::LivenessState::kIdle:
      return NativeLivenessState::kIdle;
    case offlineface::landmarks::LivenessState::kDetected:
      return NativeLivenessState::kDetected;
    case offlineface::landmarks::LivenessState::kChallengeActive:
      return NativeLivenessState::kChallengeActive;
    case offlineface::landmarks::LivenessState::kLivenessPass:
      return NativeLivenessState::kLivenessPass;
    case offlineface::landmarks::LivenessState::kLivenessFail:
      return NativeLivenessState::kLivenessFail;
  }
  return NativeLivenessState::kIdle;
}

offlineface::landmarks::LivenessChallenge FrameProcessorPlugin::ToFSMChallenge(
    NativeLivenessChallenge challenge) {
  switch (challenge) {
    case NativeLivenessChallenge::kBlink:
      return offlineface::landmarks::LivenessChallenge::kBlink;
    case NativeLivenessChallenge::kSmile:
      return offlineface::landmarks::LivenessChallenge::kSmile;
    case NativeLivenessChallenge::kTurnLeft:
      return offlineface::landmarks::LivenessChallenge::kTurnLeft;
    case NativeLivenessChallenge::kTurnRight:
      return offlineface::landmarks::LivenessChallenge::kTurnRight;
    case NativeLivenessChallenge::kNone:
      return offlineface::landmarks::LivenessChallenge::kNone;
  }
  return offlineface::landmarks::LivenessChallenge::kNone;
}

float FrameProcessorPlugin::ComputeSharpness(const uint8_t* pixels,
                                             uint32_t width,
                                             uint32_t height,
                                             uint32_t stride) const {
  if (width < 3U || height < 3U) {
    return 0.0f;
  }

  uint64_t total = 0U;
  uint64_t count = 0U;
  for (uint32_t row = 1; row + 1U < height; ++row) {
    for (uint32_t column = 1; column + 1U < width; ++column) {
      const int center = pixels[(row * stride) + column];
      const int laplacian =
          (4 * center) - pixels[(row * stride) + column - 1U] -
          pixels[(row * stride) + column + 1U] -
          pixels[((row - 1U) * stride) + column] -
          pixels[((row + 1U) * stride) + column];
      total += static_cast<uint64_t>(laplacian * laplacian);
      ++count;
    }
  }

  return count == 0U ? 0.0f : static_cast<float>(total) /
                                  static_cast<float>(count);
}

}  // namespace offlineface::frameprocessor
