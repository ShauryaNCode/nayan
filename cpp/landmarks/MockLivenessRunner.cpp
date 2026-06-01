#include "LivenessFSM.h"

#include <chrono>
#include <iostream>

namespace {

using offlineface::landmarks::FaceMetrics;
using offlineface::landmarks::LivenessChallenge;
using offlineface::landmarks::LivenessFSM;
using offlineface::landmarks::LivenessInput;
using offlineface::landmarks::ToString;

using Clock = std::chrono::steady_clock;

void PrintSnapshot(const char* label,
                   const offlineface::landmarks::LivenessSnapshot& snapshot) {
  std::cout << label << " state=" << ToString(snapshot.state)
            << " challenge=" << ToString(snapshot.challenge)
            << " requiresVerification="
            << (snapshot.requiresVerification ? "true" : "false")
            << " reason=" << snapshot.reason << '\n';
}

LivenessInput MakeInput(float ear,
                        float mar,
                        float yaw,
                        Clock::time_point timestamp,
                        bool faceDetected = true) {
  FaceMetrics metrics{};
  metrics.faceDetected = faceDetected;
  metrics.ear = ear;
  metrics.mar = mar;
  metrics.yaw = yaw;
  return {metrics, timestamp, true, true};
}

}  // namespace

int main() {
  LivenessFSM fsm;
  const Clock::time_point t0 = Clock::now();

  PrintSnapshot("initial", fsm.Snapshot());
  PrintSnapshot("detect", fsm.Update(MakeInput(0.31f, 0.18f, 0.0f, t0)));

  fsm.StartChallenge(LivenessChallenge::kBlink, t0 + std::chrono::milliseconds(50));
  PrintSnapshot("blink-open",
                fsm.Update(MakeInput(
                    0.31f, 0.18f, 0.0f, t0 + std::chrono::milliseconds(100))));
  PrintSnapshot("blink-closed",
                fsm.Update(MakeInput(
                    0.18f, 0.18f, 0.0f, t0 + std::chrono::milliseconds(220))));
  PrintSnapshot("blink-recovered",
                fsm.Update(MakeInput(
                    0.32f, 0.18f, 0.0f, t0 + std::chrono::milliseconds(520))));

  fsm.Reset(t0 + std::chrono::milliseconds(900));
  fsm.Update(MakeInput(0.31f, 0.18f, 0.0f, t0 + std::chrono::milliseconds(900)));
  fsm.StartChallenge(LivenessChallenge::kSmile,
                     t0 + std::chrono::milliseconds(950));
  PrintSnapshot("smile-start",
                fsm.Update(MakeInput(
                    0.30f, 0.52f, 0.0f, t0 + std::chrono::milliseconds(1000))));
  PrintSnapshot("smile-sustain",
                fsm.Update(MakeInput(
                    0.30f, 0.54f, 0.0f, t0 + std::chrono::milliseconds(1650))));

  fsm.Reset(t0 + std::chrono::milliseconds(2000));
  fsm.Update(MakeInput(0.31f, 0.18f, 0.0f, t0 + std::chrono::milliseconds(2000)));
  fsm.StartChallenge(LivenessChallenge::kTurnRight,
                     t0 + std::chrono::milliseconds(2050));
  PrintSnapshot("turn-right",
                fsm.Update(MakeInput(
                    0.31f, 0.18f, 24.0f, t0 + std::chrono::milliseconds(2600))));

  fsm.Reset(t0 + std::chrono::milliseconds(3000));
  fsm.Update(MakeInput(0.31f, 0.18f, 0.0f, t0 + std::chrono::milliseconds(3000)));
  fsm.StartChallenge(LivenessChallenge::kTurnLeft,
                     t0 + std::chrono::milliseconds(3050));
  PrintSnapshot("turn-left",
                fsm.Update(MakeInput(
                    0.31f, 0.18f, -23.0f, t0 + std::chrono::milliseconds(3600))));

  return fsm.RequiresVerification() ? 0 : 1;
}
