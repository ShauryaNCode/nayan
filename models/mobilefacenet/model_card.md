# MobileFaceNet TFLite Model Card

## Artifact

- File: `models/mobilefacenet/mobilefacenet.tflite`
- Size: `5.00 MB`
- SHA-256: `b67366e085ec9f6c2afb05c10397a46edeb823367abaec77f64f5ce946ac2847`

## Runtime Contract

- Input: `112x112` RGB-style tensor prepared from the CLAHE-enhanced luminance frame.
- Output: `128` float embedding values.
- Native post-processing: L2 normalization before exposing the embedding through JSI.
- Execution gate: MobileFaceNet runs only after M2 liveness reaches `LIVENESS_PASS`.

## License Audit

Record before final submission:

- Upstream source URL:
- Upstream commit/tag:
- Upstream license:
- Conversion command:
- Representative validation dataset:

Allowed licenses: Apache-2.0, MIT, BSD-2-Clause, BSD-3-Clause.

## Accuracy/Latency Audit

Record during Phase 3:

- Same-person cosine similarity across 10 lighting-varied frames:
- Different-person cosine similarity:
- P50 inference latency:
- P95 inference latency:
- P99 inference latency:
- Reference device:
