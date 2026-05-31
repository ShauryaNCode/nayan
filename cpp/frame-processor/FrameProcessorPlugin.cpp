#include "FrameProcessorPlugin.h"

#include <chrono>
#include <cstring>
#include <stdexcept>
#include <utility>

#if defined(__APPLE__)
#include <CoreVideo/CoreVideo.h>
#endif

#include "../clahe/CLAHEEngine.h"
#include "../inference/EmbeddingAverager.h"
#include "../inference/TFLiteInterpreterManager.h"

namespace offlineface::frameprocessor {
namespace {
using namespace std::chrono_literals;
using Clock = std::chrono::steady_clock;
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
  livenessState_.store(static_cast<int>(state), std::memory_order_release);
}

void FrameProcessorPlugin::SetLivenessChallenge(
    NativeLivenessChallenge challenge) {
  std::lock_guard<std::mutex> lock(fsmMutex_);
  if (challenge == NativeLivenessChallenge::kNone) {
    livenessFsm_.Reset();
    livenessState_.store(
        static_cast<int>(NativeLivenessState::kIdle),
        std::memory_order_release);
    return;
  }

  livenessFsm_.StartChallenge(ToFSMChallenge(challenge));
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

    ProcessCurrentFrame(current);
  }
}

void FrameProcessorPlugin::ProcessCurrentFrame(FrameBuffer* frame) {
  std::atomic_thread_fence(std::memory_order_acquire);
  const uint32_t width = frame->width;
  const uint32_t height = frame->height;
  const uint32_t stride = frame->stride;
  const uint64_t timestampNs = frame->timestampNs;

  std::vector<uint8_t> enhanced(
      static_cast<std::size_t>(width) * static_cast<std::size_t>(height), 0U);
  claheEngine_->Apply(frame->data, width, height, stride, enhanced.data());

  const auto faceMeshResult =
      interpreterManager_->RunFaceMesh(enhanced.data(), width, height, width);
  offlineface::landmarks::FaceMetrics metrics{};
  metrics.faceDetected = faceMeshResult.faceDetected;
  metrics.ear = faceMeshResult.eyeAspectRatio;
  metrics.mar = faceMeshResult.mouthAspectRatio;
  metrics.yaw = faceMeshResult.yawDegrees;
  metrics.pitch = faceMeshResult.pitchDegrees;
  metrics.roll = faceMeshResult.rollDegrees;

  offlineface::landmarks::LivenessSnapshot livenessSnapshot{};
  {
    std::lock_guard<std::mutex> lock(fsmMutex_);
    livenessSnapshot = livenessFsm_.Update(
        {metrics, Clock::now(), true, true});
  }
  livenessState_.store(
      static_cast<int>(ToNativeState(livenessSnapshot.state)),
      std::memory_order_release);

  const bool runMobileFaceNet =
      faceMeshResult.faceDetected && ShouldRunMobileFaceNet();

  std::vector<float> embedding;
  if (runMobileFaceNet) {
    embedding =
        interpreterManager_->RunEmbedding(enhanced.data(), width, height, width);
  }

  const auto threadBudget = interpreterManager_->GetThreadBudget();
  ProcessedFrameResult nextResult{};
  nextResult.accepted = runMobileFaceNet && !embedding.empty();
  nextResult.faceMeshProcessed = faceMeshResult.faceDetected;
  nextResult.mobileFaceNetProcessed = runMobileFaceNet;
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
  nextResult.embedding = runMobileFaceNet
                             ? embeddingAverager_->PushEmbedding(timestampNs, embedding)
                             : std::vector<float>{};
  nextResult.sharpnessScore =
      ComputeSharpness(enhanced.data(), width, height, width);

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
