#pragma once

#include <atomic>
#include <chrono>
#include <cstdint>
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
  std::chrono::milliseconds blinkWindow{800};
  float smileMar{0.45f};
  std::chrono::milliseconds smileSustain{600};
  float yawDeltaDegrees{20.0f};
  std::chrono::milliseconds turnWindow{2000};
  std::chrono::milliseconds challengeTimeout{4000};
  std::chrono::milliseconds failResetDelay{2000};
};

struct LivenessInput {
  FaceMetrics metrics{};
  std::chrono::steady_clock::time_point timestamp{
      std::chrono::steady_clock::now()};
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
  void StartChallenge(LivenessChallenge challenge,
                      std::chrono::steady_clock::time_point now =
                          std::chrono::steady_clock::now());
  void Reset(std::chrono::steady_clock::time_point now =
                 std::chrono::steady_clock::now());

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
  std::chrono::steady_clock::time_point challengeStartedAt_;
  std::chrono::steady_clock::time_point blinkClosedAt_;
  std::chrono::steady_clock::time_point smileStartedAt_;
  float baselineYaw_{0.0f};
  bool blinkWasClosed_{false};
  bool challengeSatisfied_{false};
  std::string reason_;
};

const char* ToString(LivenessState state);
const char* ToString(LivenessChallenge challenge);

}  // namespace offlineface::landmarks
