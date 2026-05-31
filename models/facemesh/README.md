# FaceMesh Model

This directory is reserved for the MediaPipe FaceMesh TFLite model used by
Member 2's native liveness engine.

## Expected File

```text
models/facemesh/face_landmark.tflite
```

The expected model is MediaPipe Face Landmarker / FaceMesh landmark output with
468 3D landmarks. The native parser expects at least `468 * 3` float values in
the output tensor.

## License Requirement

Use the MediaPipe open-source release model and keep Apache 2.0 license
attribution with the model artifact. Add the license or source note next to the
model before committing the binary.

Suggested files:

```text
models/facemesh/face_landmark.tflite
models/facemesh/LICENSE
models/facemesh/model_card.md
```

## Native Loading Path

The model is loaded through:

```cpp
landmarks::FaceMeshEngine::LoadModel(...)
```

and can also be initialized via:

```cpp
inference::TFLiteInterpreterManager::InitializeFaceMeshModel(...)
```

The implementation creates a dedicated TFLite interpreter for FaceMesh and caps
its thread budget to `2`. When TensorFlow Lite headers/delegate support are
present, the engine attaches the XNNPACK delegate with `num_threads = 2`.

## Current Phase 1 Note

The native math, parser, FSM, HostObject fields, and mock runner are complete.
The model binary itself is not committed yet. Until the binary and live camera
path are ready, use `RunFaceMeshLandmarks(...)` or `MockLivenessRunner.cpp` for
testing.
