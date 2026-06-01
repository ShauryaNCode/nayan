# Liveness Tests

The native liveness FSM can be tested before the full JSI/camera path is ready.

## Native Mock Runner

From the repository root:

```powershell
g++ -std=c++17 -Icpp\landmarks `
  cpp\landmarks\FaceMeshEngine.cpp `
  cpp\landmarks\LivenessFSM.cpp `
  cpp\landmarks\EARCalculator.cpp `
  cpp\landmarks\MARCalculator.cpp `
  cpp\landmarks\HeadPoseEstimator.cpp `
  cpp\landmarks\FaceMeshRunner.cpp `
  cpp\landmarks\MockLivenessRunner.cpp `
  -o cpp\landmarks\mock_liveness_runner.exe

.\cpp\landmarks\mock_liveness_runner.exe
```

Expected output includes:

```text
detect state=DETECTED
blink-recovered state=LIVENESS_PASS
smile-sustain state=LIVENESS_PASS
turn-right state=LIVENESS_PASS
turn-left state=LIVENESS_PASS
```

## What The Runner Covers

- Face detection transition: `IDLE -> DETECTED`
- Blink challenge: EAR below `0.21`, then above `0.28` inside `800ms`
- Smile challenge: MAR above `0.45` sustained for `600ms`
- Turn-right challenge: yaw delta above `20 degrees`
- Turn-left challenge: yaw delta below `-20 degrees`

## Integration Test Plan

When M1 finishes the live frame processor path:

1. Feed known landmark arrays through
   `TFLiteInterpreterManager::RunFaceMeshLandmarks(...)`.
2. Verify HostObject fields update: `ear`, `mar`, `yaw`, `pitch`, `roll`.
3. Dispatch each challenge with
   `FrameProcessorPlugin::SetLivenessChallenge(...)`.
4. Confirm `livenessState` reaches `LIVENESS_PASS`.
5. Confirm MobileFaceNet only runs after pass by checking
   `mobileFaceNetProcessed`.
