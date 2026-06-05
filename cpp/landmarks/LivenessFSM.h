#pragma once

#include <atomic>
#include <chrono>
#include <cstdint>
#include <cstring>
#include <string>

#include "FaceMeshEngine.h"

namespace offlineface::landmarks {

enum class LivenessState : uint8_t {
  kIdle = 0,
  kDetected = 1,
  kChallengeActive = 2,
  kLivenessPass = 3,
  kLivenessFail = 4,
};

enum class LivenessChallenge : uint8_t {
  kNone = 0,
  kBlink = 1,
  kSmile = 2,
  kTurnLeft = 3,
  kTurnRight = 4,
};

struct LivenessThresholds {
  float blinkClosedEar{0.21f};
  float blinkOpenEar{0.28f};
  float blinkRecoveryEar{0.04f};
  float blinkScaledEarMultiplier{1.5f};
  float blinkScaledCloseDropRatio{0.01f};
  float blinkScaledOpenDropRatio{0.004f};
  float blinkScaledMinCloseDrop{0.006f};
  float blinkRelativeCloseDropRatio{0.06f};
  float blinkRelativeMinCloseDrop{0.008f};
  float blinkRelativeRecoveryRatio{0.035f};
  float blinkRelativeMinRecovery{0.006f};
  std::chrono::milliseconds blinkWindow{800};
  float smileMar{0.45f};
  std::chrono::milliseconds smileSustain{600};
  float yawDeltaDegrees{6.0f};
  std::chrono::milliseconds turnWindow{2000};
  std::chrono::milliseconds challengeTimeout{4000};
  std::chrono::milliseconds failResetDelay{2000};
  std::chrono::milliseconds faceDropoutTolerance{1000};
};

struct LivenessInput {
  FaceMetrics metrics{};
  std::chrono::steady_clock::time_point timestamp{std::chrono::steady_clock::now()};
  bool passiveTextureOk{true};
  bool passiveDepthOk{true};
};

struct LivenessSnapshot {
  LivenessState state{LivenessState::kIdle};
  LivenessChallenge challenge{LivenessChallenge::kNone};
  float baselineYaw{0.0f};
  bool requiresVerification{false};
  bool challengeSatisfied{false};
  std::string reason;
};

class LivenessFSM {
 public:
  explicit LivenessFSM(LivenessThresholds thresholds = {});

  LivenessSnapshot Update(const LivenessInput& input);
  // Run passive anti‑spoof checks (FFT texture analysis) and update internal flag.
  bool RunPassiveChecks(const LivenessInput& input);

  void StartChallenge(LivenessChallenge challenge,
                       std::chrono::steady_clock::time_point now =
                           std::chrono::steady_clock::now());
  void Reset(std::chrono::steady_clock::time_point now =
                 std::chrono::steady_clock::now());
  void ForcePass(const char* reason = "verification pass forced");

  LivenessSnapshot Snapshot() const;
  bool RequiresVerification() const;
  LivenessState State() const;
  LivenessChallenge Challenge() const;

 private:
  void StoreState(LivenessState state);
  void StoreChallenge(LivenessChallenge challenge);
  void Fail(const char* reason, std::chrono::steady_clock::time_point now);
  void Pass(const char* reason);
  bool ChallengeTimedOut(std::chrono::steady_clock::time_point now) const;
  void EvaluateBlink(const LivenessInput& input);
  void EvaluateSmile(const LivenessInput& input);
  void EvaluateTurn(const LivenessInput& input, bool left);

  LivenessThresholds thresholds_;
  std::atomic<int> state_{static_cast<int>(LivenessState::kIdle)};
  std::atomic<int> challenge_{static_cast<int>(LivenessChallenge::kNone)};
  std::atomic<bool> requiresVerification_{false};

  std::chrono::steady_clock::time_point stateEnteredAt_;
  // Cached result of the most recent passive check.
  bool lastPassiveOk_{true};
  std::chrono::steady_clock::time_point challengeStartedAt_;
  std::chrono::steady_clock::time_point lastFaceSeenAt_;
  std::chrono::steady_clock::time_point blinkClosedAt_;
  std::chrono::steady_clock::time_point smileStartedAt_;
  float baselineYaw_{0.0f};
  float baselineEar_{0.0f};
  float blinkMinEarDuringClosure_{0.0f};
  float baselineMar_{0.0f};
  bool blinkWasClosed_{false};
  bool blinkBaselineCaptured_{false};
  bool smileBaselineCaptured_{false};
  bool challengeSatisfied_{false};
  bool turnBaselineCaptured_{false};
  bool hasLastFaceSeen_{false};
  std::string reason_;
};

const char* ToString(LivenessState state);
const char* ToString(LivenessChallenge challenge);

}  // namespace offlineface::landmarks
