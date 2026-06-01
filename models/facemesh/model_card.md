# MediaPipe FaceMesh TFLite Model Card

## Artifact

- File: `models/facemesh/face_landmark.tflite`
- Size: `1.18 MB`
- SHA-256: `1055cb9d4a9ca8b8c688902a3a5194311138ba256bcc94e336d8373a5f30c814`

## Runtime Contract

- Input: camera-derived face frame tensor, prepared by the native TFLite path when TensorFlow Lite headers/libraries are linked.
- Output: at least `468 * 3` float values.
- Native parser: converts output into 468 3D landmarks.
- Native metrics: EAR, MAR, yaw, pitch, roll.
- Liveness integration: metrics are fed into M2's native FSM every processed frame.

## License Audit

Record before final submission:

- Upstream source URL:
- Upstream release/tag:
- Upstream license:
- Output tensor name/shape:
- Representative validation clips:

Expected license: Apache-2.0.

## Accuracy/Latency Audit

Record during Phase 3:

- Blink EAR closed/open thresholds validation:
- Smile MAR threshold validation:
- Turn yaw delta validation:
- P95 FaceMesh latency:
- Reference device:
