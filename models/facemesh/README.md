# MediaPipe FaceMesh Model

Expected production artifact:

```text
models/facemesh/face_landmark.tflite
```

Android also accepts:

```text
/sdcard/Download/face_landmark.tflite
```

The native `FaceMeshEngine` parses `468 * 3` float landmark output and computes
EAR, MAR, yaw, pitch, and roll with OpenCV-free C++ math. When TensorFlow Lite
C++ headers and libraries are linked, the engine creates a dedicated TFLite
interpreter and attaches XNNPACK with two threads.

License gate before committing a binary:

- Use an Apache-2.0 MediaPipe model release.
- Add the upstream Apache-2.0 license file next to the model.
- Record source URL, commit/tag, SHA-256, output tensor shape, and final size in
  `model_card.md`.
- Keep the `.tflite` file close to 3 MB so the full offline model bundle stays
  below 20 MB.
