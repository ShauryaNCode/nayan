# Landmark And Liveness Engine

This folder contains Member 2 Phase 1 native work for MediaPipe FaceMesh
metrics and the 5-state liveness FSM.

## Files

- `FaceMeshEngine.h/.cpp`: typed 468-point FaceMesh parser, optional TFLite
  loading path, EAR, MAR, and head-pose metrics.
- `LivenessFSM.h/.cpp`: native liveness state machine.
- `MockLivenessRunner.cpp`: standalone threshold and transition smoke test.
- `EARCalculator.*`, `MARCalculator.*`, `HeadPoseEstimator.*`: compatibility
  wrappers around `FaceMeshEngine` math.
- `FaceMeshRunner.*`: compatibility alias for the new engine.

## Landmark Schema

`FaceLandmarks` is an `std::array<Landmark3D, 468>`.

Each point is:

```cpp
struct Landmark3D {
  float x;
  float y;
  float z;
};
```

The per-frame metric output is:

```cpp
struct FaceMetrics {
  float ear;
  float mar;
  float yaw;
  float pitch;
  float roll;
  bool faceDetected;
};
```

## Metric Formulas

EAR uses the required MediaPipe indices:

- Left eye: `33, 160, 158, 133, 153, 144`
- Right eye: `362, 385, 387, 263, 373, 380`

For each eye:

```text
EAR = (distance(p2, p6) + distance(p3, p5)) / (2 * distance(p1, p4))
```

The engine returns the average of left and right EAR.

MAR uses:

- Mouth: `13, 312, 87, 178, 82, 311`

```text
MAR = (distance(13, 178) + distance(312, 87)) / (2 * distance(82, 311))
```

Head pose uses six canonical landmarks:

- Nose tip: `1`
- Chin: `152`
- Left eye outer: `33`
- Right eye outer: `263`
- Left mouth: `61`
- Right mouth: `291`

The solver is OpenCV-free. It projects a canonical 3D face model into image
space and optimizes rotation/translation with Levenberg-Marquardt. Yaw, pitch,
and roll are then derived from the optimized rotation matrix.

## FSM States

The liveness FSM implements the required 5 states:

- `IDLE`
- `DETECTED`
- `CHALLENGE_ACTIVE`
- `LIVENESS_PASS`
- `LIVENESS_FAIL`

Threshold defaults:

- Blink: EAR drops below `0.21` and recovers above `0.28` within `800ms`.
- Smile: MAR stays above `0.45` for `600ms`.
- Turn left/right: yaw delta exceeds `20 degrees` within `2s`.
- Challenge timeout: `4s`.
- Fail reset delay: `2s`.

State and challenge flags use `std::atomic` with acquire/release ordering so
camera, inference, and UI-facing threads can share state safely on ARM.

## Mock Runner

Compile and run from the repository root:

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

The runner feeds synthetic EAR/MAR/yaw values into the FSM and prints each
transition. This is the fastest way to tune thresholds before M1's live camera
and frame processor path is ready.
