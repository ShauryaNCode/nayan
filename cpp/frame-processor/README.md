# Frame Processor Integration

This folder contains the native frame processor plugin, mailbox scheduler, JSI
HostObject result surface, and pixel buffer pool.

## Phase 1 Liveness Wiring

Member 2's native liveness work is now connected at the frame processor seam.
`FrameProcessorPlugin::ProcessCurrentFrame(...)` performs this sequence:

1. Drain the single-slot mailbox.
2. Apply CLAHE to the incoming luminance frame.
3. Run FaceMesh through `TFLiteInterpreterManager::RunFaceMesh(...)`.
4. Convert the FaceMesh result into `FaceMetrics`.
5. Update `landmarks::LivenessFSM`.
6. Run MobileFaceNet only when the FSM state is `LIVENESS_PASS`.
7. Publish the latest metrics through `ProcessedFrameResult` and HostObject.

## HostObject Fields

The JS/Skia/UI side can read:

- `accepted`
- `timestampNs`
- `sharpnessScore`
- `faceMeshProcessed`
- `mobileFaceNetProcessed`
- `droppedFrameCount`
- `replacedFrameCount`
- `faceMeshThreadCount`
- `mobileFaceNetThreadCount`
- `livenessState`
- `livenessChallenge`
- `faceDetected`
- `ear`
- `mar`
- `yaw`
- `pitch`
- `roll`
- `embedding`
- `embeddingLength`
- `embeddingByteLength`

`livenessState` values:

- `0`: IDLE
- `1`: DETECTED
- `2`: CHALLENGE_ACTIVE
- `3`: LIVENESS_PASS
- `4`: LIVENESS_FAIL

`livenessChallenge` values:

- `0`: NONE
- `1`: BLINK
- `2`: SMILE
- `3`: TURN_LEFT
- `4`: TURN_RIGHT

## Challenge Dispatch

The native seam for active challenge dispatch is:

```cpp
FrameProcessorPlugin::SetLivenessChallenge(NativeLivenessChallenge challenge);
```

M1 or the JSI bridge should call this once the UI dispatches a challenge. The
FSM then evaluates subsequent FaceMesh metrics on the inference thread.

## Threading Notes

The frame processor uses a single-slot atomic mailbox:

- New camera frames overwrite stale frames.
- The inference thread drains the latest available frame.
- Frame payload publication uses release fences.
- Inference reads use acquire fences.

This keeps queue growth bounded and preserves the Phase 1 stability requirement
that MobileFaceNet only runs after liveness passes.
