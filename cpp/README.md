# Native C++ Engine

This directory contains the shared native engine used by Android JNI and the
future iOS Obj-C++ bridge. Phase 1 now includes the Member 2 liveness slice:
FaceMesh metric extraction, OpenCV-free head pose, and the native liveness FSM.

## Current Phase 1 Status

Member 2 work is complete at the native-core integration point:

- FaceMesh metric engine is implemented in `landmarks/FaceMeshEngine.*`.
- EAR, MAR, yaw, pitch, and roll are computed from typed 468-point landmarks.
- The liveness FSM is implemented in `landmarks/LivenessFSM.*`.
- A standalone mock runner exists at `landmarks/MockLivenessRunner.cpp`.
- Frame processor results expose `faceDetected`, `ear`, `mar`, `yaw`, `pitch`,
  `roll`, `livenessState`, and `livenessChallenge` through the HostObject.
- MobileFaceNet remains gated behind `LIVENESS_PASS`.

## Build Check

From the repository root:

```powershell
.\android\gradlew.bat -p android :app:externalNativeBuildDebug
```

Expected result: `BUILD SUCCESSFUL`.

## Standalone Liveness Check

The mock runner verifies blink, smile, turn-left, and turn-right without camera
or JSI dependencies:

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

Expected transitions include `DETECTED`, `CHALLENGE_ACTIVE`, and
`LIVENESS_PASS` for each mocked challenge.

## M1 Integration Contract

When Member 1 completes the live JSI frame processor slice, plug into the
existing seam instead of creating a second liveness path:

- Use `inference/TFLiteInterpreterManager::RunFaceMesh(...)` for live frame
  inference.
- Use `RunFaceMeshLandmarks(...)` for temporary integration tests with raw
  `468 * 3` landmark floats.
- Dispatch active challenges with
  `frameprocessor::FrameProcessorPlugin::SetLivenessChallenge(...)`.
- Read the HostObject fields listed above from JS/Skia UI code.

The frame processor already updates the native FSM every processed frame and
only runs MobileFaceNet once the FSM reaches `LIVENESS_PASS`.
