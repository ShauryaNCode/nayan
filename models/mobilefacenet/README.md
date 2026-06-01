# MobileFaceNet Model

Expected production artifact:

```text
models/mobilefacenet/mobilefacenet.tflite
```

Android also accepts:

```text
/sdcard/Download/mobilefacenet.tflite
```

Phase 1 native code now has a concrete `MobileFaceNetRunner` surface. When
TensorFlow Lite C++ headers and libraries are present, the runner loads the
TFLite model, prepares a 112x112 replicated-RGB input from the CLAHE-enhanced
luminance frame, invokes the interpreter, and L2-normalizes a 128-D embedding.

If TensorFlow Lite is not linked, the app remains buildable and uses the native
deterministic fallback embedding only for integration testing. Do not use the
fallback for accuracy claims.

License gate before committing a binary:

- Source repository must be Apache-2.0, MIT, BSD-2-Clause, or BSD-3-Clause.
- Add the upstream license file next to the model.
- Record source URL, commit/tag, conversion command, SHA-256, and final size in
  `model_card.md`.
- Keep the converted `.tflite` file at or below 5 MB.
