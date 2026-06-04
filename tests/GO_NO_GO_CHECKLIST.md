# Go / No-Go Checklist – Day 17 Validation
**Project:** Nayan OfflineFaceAuth  
**Branch:** `m4-phase3`  
**Date:** 2026-06-04  
**Phase:** Member 4 – Phase 3

---

> [!IMPORTANT]
> All 4 criteria below are **hard blockers**. A single ❌ = No-Go.  
> Approval signature required from Member 4 tech lead before merging to `main`.

---

## Criteria Scorecard

| # | Criterion | Threshold | Measurement Method | Status | Evidence |
|---|---|---|---|---|---|
| **GNG-01** | Face recognition accuracy | **> 95%** | 100-person trial on 3 physical devices; correct match count / total attempts | ☐ GO ☐ NO-GO | `tests/PHYSICAL_DEVICE_CHECKLIST.md` |
| **GNG-02** | End-to-end verification latency | **< 1 s** | Logcat timestamp delta: frame_captured → result_returned | ☐ GO ☐ NO-GO | Logcat + stopwatch |
| **GNG-03** | Release APK bundle size | **< 20 MB** | `node scripts/verify-model-bundle.js` + `du -sh` on APK | ☐ GO ☐ NO-GO | Script output below |
| **GNG-04** | `verifyChain()` tamper detection | **Must pass all scenarios** | Integration tests INT-TD-01 through INT-TD-08 | ✅ **GO** | `tests/INTEGRATION_TEST_REPORT.md` |

---

## GNG-01 – Accuracy > 95%

### Measurement Protocol

```
Participants : 10 unique individuals × 10 verification attempts each = 100 total
Devices      : Samsung Galaxy S23 Ultra (D1), Pixel 7 Pro (D2), OnePlus 11 (D3)
Threshold    : Cosine distance < 0.40 (MobileFaceNet 128-d embedding)
Reject rate  : < 5% false rejections on enrolled persons
```

### Results Template

| Device | Correct Matches | Total Attempts | Accuracy | Status |
|---|---|---|---|---|
| Samsung Galaxy S23 Ultra (D1) | __ | 100 | __% | ☐ |
| Google Pixel 7 Pro (D2) | __ | 100 | __% | ☐ |
| OnePlus 11 (D3) | __ | 100 | __% | ☐ |
| **Combined** | __ | 300 | **__%** | |

**Decision:** ☐ GO (≥ 95% on all devices) &nbsp;&nbsp; ☐ NO-GO (any device < 95%)

---

## GNG-02 – Latency < 1 s

### Measurement Protocol

```
Metric    : Time from camera frame processed by Frame Processor to __offlineFaceAuth.getLatestResult() returning
Tool      : Android Logcat (filter: [OfflineFaceAuth][timing]), stopwatch on-device
Sample    : 10 consecutive verifications per device × 3 devices = 30 measurements
Threshold : p95 latency ≤ 1000 ms; no single sample > 2000 ms
```

### ADB Logcat Filter

```powershell
adb logcat -s "OfflineFaceAuth:V" | Select-String "timing|latency|ms"
```

### Results Template

| Device | p50 (ms) | p95 (ms) | Max (ms) | Status |
|---|---|---|---|---|
| Samsung Galaxy S23 Ultra (D1) | __ | __ | __ | ☐ |
| Google Pixel 7 Pro (D2) | __ | __ | __ | ☐ |
| OnePlus 11 (D3) | __ | __ | __ | ☐ |

**Decision:** ☐ GO (p95 ≤ 1000 ms on all devices) &nbsp;&nbsp; ☐ NO-GO (any p95 > 1000 ms)

---

## GNG-03 – Bundle Size < 20 MB

### Measurement Commands

```powershell
# 1. Build release APK
cd android
./gradlew assembleRelease

# 2. Check APK size
(Get-Item "app/build/outputs/apk/release/app-release.apk").Length / 1MB

# 3. Run bundle verification script
cd ..
node scripts/verify-model-bundle.js
```

### Results Template

| Artifact | Size | Threshold | Status |
|---|---|---|---|
| `app-release.apk` | __ MB | < 20 MB | ☐ |
| `mobilefacenet.tflite` (assets) | __ MB | < 10 MB | ☐ |
| `models/` directory total | __ MB | < 15 MB | ☐ |

> [!TIP]
> If APK exceeds 20 MB, check the following:
> - `reactNativeArchitectures` in `gradle.properties` — limit to `arm64-v8a` for release
> - TFLite select-ops `.so` size (included via `tensorflow-lite-select-tf-ops`)
> - Enable `minifyEnabled true` and ProGuard in release build type

**Decision:** ☐ GO (APK ≤ 20 MB) &nbsp;&nbsp; ☐ NO-GO (APK > 20 MB)

---

## GNG-04 – verifyChain() Tamper Detection

### Test Results (from `npm test`)

```
PASS tests/integration/tamper-detection.test.ts
  Tamper Detection – verifyChain()
    ✓ INT-TD-01: verifyChain returns -1 for an untampered ledger        (5 ms)
    ✓ INT-TD-02: tampered row_hash is detected at correct index         (< 1 ms)
    ✓ INT-TD-03: tampered timestamp is detected as a broken link        (< 1 ms)
    ✓ INT-TD-04: tampered user_id is detected                           (< 1 ms)
    ✓ INT-TD-05: forged row_hash with wrong prev_hash reference detected (< 1 ms)
    ✓ INT-TD-06: empty ledger verifies as intact                        (1 ms)
    ✓ INT-TD-07: single-row ledger with correct hash verifies intact    (< 1 ms)
    ✓ INT-TD-08: inserted rogue row at middle correctly breaks chain    (< 1 ms)

Tests: 8 passed, 8 total
```

**Decision:** ✅ **GO** – All 8 tamper scenarios detected. SHA-256 chain integrity verified.

---

## Supporting Evidence

| Report | Location | Status |
|---|---|---|
| E2E Execution Report (emulator) | `tests/e2e/E2E_EXECUTION_REPORT.md` | Available (pending emulator run) |
| Integration Test Report | `tests/INTEGRATION_TEST_REPORT.md` | ✅ 29/29 PASS |
| Physical Device Checklist | `tests/PHYSICAL_DEVICE_CHECKLIST.md` | ☐ Pending physical execution |
| Android Build Log | `android/.gradle/` | Run `./gradlew assembleDebug` |

---

## Final Decision

| Criterion | Decision | Approver | Date |
|---|---|---|---|
| GNG-01 Accuracy > 95% | ☐ GO ☐ NO-GO | _________________ | __________ |
| GNG-02 Latency < 1 s | ☐ GO ☐ NO-GO | _________________ | __________ |
| GNG-03 Bundle < 20 MB | ☐ GO ☐ NO-GO | _________________ | __________ |
| GNG-04 verifyChain() | ✅ GO | M4 / Automated | 2026-06-04 |

### **Overall Decision:** ☐ GO &nbsp;&nbsp; ☐ NO-GO

> [!CAUTION]
> A NO-GO decision blocks merge to `main` and requires a hotfix branch.
> Open a GitHub issue tagged `day17-blocker` with the failing criterion details.

---

## Remediation Paths (if NO-GO)

| Criterion | Likely Cause | Fix |
|---|---|---|
| Accuracy < 95% | Threshold too tight / model not loaded | Verify `mobilefacenet.tflite` at `MODEL_PATH`; tune cosine threshold |
| Latency > 1 s | TFLite op selection overhead | Profile with Android Studio CPU profiler; enable GPU delegate |
| Bundle > 20 MB | Multi-ABI build / TFLite select ops | Filter to `arm64-v8a` only; strip debug symbols |
| verifyChain fails | SHA-256 computation mismatch | Check `ChainVerifier.ts` hash input ordering matches `BlockchainLedger.ts` |
