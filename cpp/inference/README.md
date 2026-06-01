# Inference Pipeline

This folder contains native inference coordination for FaceMesh and
MobileFaceNet.

## Thread Budget

Both FaceMesh and MobileFaceNet are capped at two TFLite threads on mid-range
devices. The manager reports the configured budget through:

```cpp
InterpreterThreadBudget TFLiteInterpreterManager::GetThreadBudget() const;
```

The current policy is:

- Fewer than 8 logical cores: `2` threads per interpreter.
- 8 or more logical cores: `3` threads per interpreter.

Member 2's `FaceMeshEngine` additionally calls `builder.SetNumThreads(2)` and
configures XNNPACK with `num_threads = 2` when TensorFlow Lite headers are
available in the build.

## FaceMesh Entry Points

Use these entry points for the M1/M2 integration checkpoint:

```cpp
FaceMeshResult RunFaceMesh(const uint8_t* grayPixels,
                           uint32_t width,
                           uint32_t height,
                           uint32_t stride);

FaceMeshResult RunFaceMeshLandmarks(const float* landmarkValues,
                                    std::size_t valueCount,
                                    uint32_t width,
                                    uint32_t height) const;
```

`RunFaceMesh(...)` is the live frame path.

`RunFaceMeshLandmarks(...)` is the bridge/testing path for raw MediaPipe
`468 * 3` float output. It lets M1 validate the handoff before the camera and
JSI frame processor are fully live.

## FaceMesh Result Shape

```cpp
struct FaceMeshResult {
  bool faceDetected;
  float eyeAspectRatio;
  float mouthAspectRatio;
  float yawDegrees;
  float pitchDegrees;
  float rollDegrees;
};
```

These values are forwarded into the native liveness FSM and exposed through the
JSI HostObject.

## MobileFaceNet Gate

MobileFaceNet must remain conditional:

```text
FaceMesh always -> LIVENESS_PASS? -> yes: MobileFaceNet -> no: skip
```

This preserves the mailbox drain rate and avoids running two TFLite models
during active liveness challenge tracking.
