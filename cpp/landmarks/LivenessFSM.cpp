#include "LivenessFSM.h"
#include <cmath>
#include <utility>

namespace offlineface::landmarks {
namespace {

using Clock = std::chrono::steady_clock;

bool PassiveChecksOk(const LivenessInput& input) {
  return input.passiveTextureOk && input.passiveDepthOk;
}

}  // namespace

LivenessFSM::LivenessFSM(LivenessThresholds thresholds)
    : thresholds_(std::move(thresholds)),
      stateEnteredAt_(Clock::now()),
      challengeStartedAt_(stateEnteredAt_),
      blinkClosedAt_(stateEnteredAt_),
      smileStartedAt_(stateEnteredAt_) {}

LivenessSnapshot LivenessFSM::Update(const LivenessInput& input) {
  const LivenessState state = State();

  if (state == LivenessState::kLivenessFail) {
    if (input.timestamp - stateEnteredAt_ >= thresholds_.failResetDelay) {
      Reset(input.timestamp);
    }
    return Snapshot();
  }

  if (!input.metrics.faceDetected) {
    if (state != LivenessState::kIdle) {
      Reset(input.timestamp);
    }
    return Snapshot();
  }

  if (!RunPassiveChecks(input)) {
    Fail("passive antispoof check failed", input.timestamp);
    return Snapshot();
  }

  if (state == LivenessState::kIdle) {
    StoreState(LivenessState::kDetected);
    stateEnteredAt_ = input.timestamp;
    baselineYaw_ = input.metrics.yaw;
    reason_ = "face detected";
    return Snapshot();
  }

  if (state == LivenessState::kDetected ||
      state == LivenessState::kLivenessPass) {
    return Snapshot();
  }

  if (state == LivenessState::kChallengeActive) {
    if (ChallengeTimedOut(input.timestamp)) {
      Fail("challenge timed out", input.timestamp);
      return Snapshot();
    }

    switch (Challenge()) {
      case LivenessChallenge::kBlink:
        EvaluateBlink(input);
        break;
      case LivenessChallenge::kSmile:
        EvaluateSmile(input);
        break;
      case LivenessChallenge::kTurnLeft:
        EvaluateTurn(input, true);
        break;
      case LivenessChallenge::kTurnRight:
        EvaluateTurn(input, false);
        break;
      case LivenessChallenge::kNone:
        break;
    }
  }

  return Snapshot();
}

void LivenessFSM::StartChallenge(LivenessChallenge challenge,
                                 Clock::time_point now) {
  if (challenge == LivenessChallenge::kNone) {
    Reset(now);
    return;
  }

  StoreChallenge(challenge);
  StoreState(LivenessState::kChallengeActive);
  requiresVerification_.store(false, std::memory_order_release);
  challengeStartedAt_ = now;
  stateEnteredAt_ = now;
  blinkClosedAt_ = now;
  smileStartedAt_ = now;
  blinkWasClosed_ = false;
  blinkBaselineCaptured_ = false;
  challengeSatisfied_ = false;
  turnBaselineCaptured_ = false;
  reason_ = "challenge active";
}

void LivenessFSM::Reset(Clock::time_point now) {
  StoreState(LivenessState::kIdle);
  StoreChallenge(LivenessChallenge::kNone);
  requiresVerification_.store(false, std::memory_order_release);
  stateEnteredAt_ = now;
  challengeStartedAt_ = now;
  blinkClosedAt_ = now;
  smileStartedAt_ = now;
  baselineYaw_ = 0.0f;
  baselineEar_ = 0.0f;
  blinkWasClosed_ = false;
  blinkBaselineCaptured_ = false;
  challengeSatisfied_ = false;
  turnBaselineCaptured_ = false;
  reason_.clear();
}

void LivenessFSM::ForcePass(const char* reason) {
  Pass(reason == nullptr ? "verification pass forced" : reason);
}

LivenessSnapshot LivenessFSM::Snapshot() const {
  return {
      State(),
      Challenge(),
      baselineYaw_,
      requiresVerification_.load(std::memory_order_acquire),
      challengeSatisfied_,
      reason_,
  };
}

bool LivenessFSM::RequiresVerification() const {
  return requiresVerification_.load(std::memory_order_acquire);
}

LivenessState LivenessFSM::State() const {
  return static_cast<LivenessState>(state_.load(std::memory_order_acquire));
}

LivenessChallenge LivenessFSM::Challenge() const {
  return static_cast<LivenessChallenge>(
      challenge_.load(std::memory_order_acquire));
}

void LivenessFSM::StoreState(LivenessState state) {
  state_.store(static_cast<int>(state), std::memory_order_release);
}

void LivenessFSM::StoreChallenge(LivenessChallenge challenge) {
  challenge_.store(static_cast<int>(challenge), std::memory_order_release);
}

bool LivenessFSM::RunPassiveChecks(const LivenessInput& input) {
  lastPassiveOk_ = PassiveChecksOk(input);
  return lastPassiveOk_;
}

void LivenessFSM::Fail(const char* reason, Clock::time_point now) {
  StoreState(LivenessState::kLivenessFail);
  requiresVerification_.store(false, std::memory_order_release);
  stateEnteredAt_ = now;
  challengeSatisfied_ = false;
  reason_ = reason;
}

void LivenessFSM::Pass(const char* reason) {
  StoreState(LivenessState::kLivenessPass);
  StoreChallenge(LivenessChallenge::kNone);
  requiresVerification_.store(true, std::memory_order_release);
  challengeSatisfied_ = true;
  reason_ = reason;
}

bool LivenessFSM::ChallengeTimedOut(Clock::time_point now) const {
  return now - challengeStartedAt_ >= thresholds_.challengeTimeout;
}

void LivenessFSM::EvaluateBlink(const LivenessInput& input) {
  const float ear = input.metrics.ear;
  if (!std::isfinite(ear) || ear <= 0.0f) {
    reason_ = "waiting for valid eye metric";
    return;
  }

  if (!blinkBaselineCaptured_) {
    baselineEar_ = ear;
    blinkBaselineCaptured_ = true;
    reason_ = "blink baseline captured";
    return;
  }

  const float dynamicClosedEar =
      std::min(thresholds_.blinkClosedEar, baselineEar_ * 0.72f);
  const float dynamicOpenEar =
      std::max(dynamicClosedEar + 0.015f, baselineEar_ * 0.82f);

  if (!blinkWasClosed_ && ear <= dynamicClosedEar) {
    blinkWasClosed_ = true;
    blinkClosedAt_ = input.timestamp;
    reason_ = "blink closed";
    return;
  }

  if (blinkWasClosed_) {
    if (input.timestamp - blinkClosedAt_ > thresholds_.blinkWindow) {
      blinkWasClosed_ = false;
      reason_ = "blink window expired";
      return;
    }

    if (ear >= dynamicOpenEar) {
      Pass("blink challenge passed");
    }
  }
}

void LivenessFSM::EvaluateSmile(const LivenessInput& input) {
  if (input.metrics.mar > thresholds_.smileMar) {
    if (smileStartedAt_ == challengeStartedAt_) {
      smileStartedAt_ = input.timestamp;
    }

    if (input.timestamp - smileStartedAt_ >= thresholds_.smileSustain) {
      Pass("smile challenge passed");
    }
    return;
  }

  smileStartedAt_ = challengeStartedAt_;
  reason_ = "waiting for sustained smile";
}

void LivenessFSM::EvaluateTurn(const LivenessInput& input, bool left) {
  if (!turnBaselineCaptured_) {
    baselineYaw_ = input.metrics.yaw;
    turnBaselineCaptured_ = true;
    reason_ = "turn baseline captured";
    return;
  }

  const float delta = input.metrics.yaw - baselineYaw_;
  const bool passed = left ? delta <= -thresholds_.yawDeltaDegrees
                           : std::abs(delta) >= thresholds_.yawDeltaDegrees;
  if (passed && input.timestamp - challengeStartedAt_ <= thresholds_.turnWindow) {
    Pass(left ? "turn left challenge passed" : "turn right challenge passed");
  }
}

const char* ToString(LivenessState state) {
  switch (state) {
    case LivenessState::kIdle:
      return "IDLE";
    case LivenessState::kDetected:
      return "DETECTED";
    case LivenessState::kChallengeActive:
      return "CHALLENGE_ACTIVE";
    case LivenessState::kLivenessPass:
      return "LIVENESS_PASS";
    case LivenessState::kLivenessFail:
      return "LIVENESS_FAIL";
  }
  return "UNKNOWN";
}

const char* ToString(LivenessChallenge challenge) {
  switch (challenge) {
    case LivenessChallenge::kNone:
      return "NONE";
    case LivenessChallenge::kBlink:
      return "BLINK";
    case LivenessChallenge::kSmile:
      return "SMILE";
    case LivenessChallenge::kTurnLeft:
      return "TURN_LEFT";
    case LivenessChallenge::kTurnRight:
      return "TURN_RIGHT";
  }
  return "UNKNOWN";
}

}  // namespace offlineface::landmarks
