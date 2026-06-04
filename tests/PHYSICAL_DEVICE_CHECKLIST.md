# Physical Device Test Checklist
**Branch:** `m4-phase3` | **Date:** 2026-06-04 | **Phase:** Day 17 Go/No-Go

---

## Test Matrix – 3 Devices

> [!IMPORTANT]
> All three devices must run the **debug APK** built from `m4-phase3` HEAD.
> Build command: `cd android && ./gradlew assembleDebug`
> Install: `adb install -r android/app/build/outputs/apk/debug/app-debug.apk`

| # | Device | OS | Arch | ADB Serial |
|---|---|---|---|---|
| D1 | Samsung Galaxy S23 Ultra | Android 14 (API 34) | arm64-v8a | `(fill in)` |
| D2 | Google Pixel 7 Pro | Android 13 (API 33) | arm64-v8a | `(fill in)` |
| D3 | OnePlus 11 | Android 13 (API 33) | arm64-v8a | `(fill in)` |

---

## Pre-Test Setup (All Devices)

- [ ] USB debugging enabled
- [ ] APK installed from m4-phase3 HEAD build
- [ ] Camera permission granted at first launch
- [ ] `mobilefacenet.tflite` model at `/sdcard/Download/mobilefacenet.tflite`
- [ ] WiFi disabled for offline tests (TC-PD-05 through TC-PD-08)
- [ ] Fresh app install (no previous data from prior builds)

---

## Checklist – Device 1 (Samsung Galaxy S23 Ultra / Android 14)

### App Launch & Engine Init

| ID | Test | Expected | D1 Result | Notes |
|---|---|---|---|---|
| TC-PD-D1-01 | App launches without crash | Opens to harness screen | ☐ PASS ☐ FAIL | |
| TC-PD-D1-02 | "Engine Presence: Injected" within 3 s | Status card shows "Injected" | ☐ PASS ☐ FAIL | |
| TC-PD-D1-03 | Front camera preview renders | Live video visible | ☐ PASS ☐ FAIL | |
| TC-PD-D1-04 | Frame Processor Plugin: Registered | Status shows "Registered" | ☐ PASS ☐ FAIL | |

### Enrollment Flow

| ID | Test | Expected | D1 Result | Notes |
|---|---|---|---|---|
| TC-PD-D1-05 | Tap "Mark Liveness Passed" | Console: "Liveness FSM marked PASS" | ☐ PASS ☐ FAIL | |
| TC-PD-D1-06 | Face visible → Read Latest Native Result | `accepted: true/false`, embedding array present | ☐ PASS ☐ FAIL | |
| TC-PD-D1-07 | Embedding length = 128 | `embeddingLength: 128` | ☐ PASS ☐ FAIL | |
| TC-PD-D1-08 | `sharpnessScore` > 0 | Non-zero float value | ☐ PASS ☐ FAIL | |

### Verification Flow (Live Face)

| ID | Test | Expected | D1 Result | Notes |
|---|---|---|---|---|
| TC-PD-D1-09 | Real face scan accepted (cosine sim > threshold) | `accepted: true` | ☐ PASS ☐ FAIL | Accuracy gate: >95% |
| TC-PD-D1-10 | Liveness fields present | `ear`, `mar`, `yaw`, `pitch`, `roll` non-null | ☐ PASS ☐ FAIL | |
| TC-PD-D1-11 | End-to-end latency < 1 s | Result appears within 1 s of frame capture | ☐ PASS ☐ FAIL | Stopwatch or Logcat |

### Anti-Spoof

| ID | Test | Expected | D1 Result | Notes |
|---|---|---|---|---|
| TC-PD-D1-12 | Present printed face photo | `livenessState: 3` (LIVENESS_FAIL) | ☐ PASS ☐ FAIL | |
| TC-PD-D1-13 | Spoof attempt NOT accepted | `accepted: false` | ☐ PASS ☐ FAIL | |

### SQLCipher Storage

| ID | Test | Expected | D1 Result | Notes |
|---|---|---|---|---|
| TC-PD-D1-14 | Storage Smoke Test: SQLCipher PASS | Console: "SQLCipher smoke test: PASS" | ☐ PASS ☐ FAIL | |
| TC-PD-D1-15 | Storage Smoke Test: MMKV PASS | Console: "MMKV smoke test: PASS" | ☐ PASS ☐ FAIL | |
| TC-PD-D1-16 | DB file encrypted (no plaintext via `adb pull`) | `strings face_auth.db` shows no SQL | ☐ PASS ☐ FAIL | |

### Offline Queue & AWS Sync

| ID | Test | Expected | D1 Result | Notes |
|---|---|---|---|---|
| TC-PD-D1-17 | Disable WiFi → perform verification | App does not crash | ☐ PASS ☐ FAIL | |
| TC-PD-D1-18 | Re-enable WiFi → sync triggers | Console: no errors during reconnect | ☐ PASS ☐ FAIL | |

**Device 1 Score:** _____ / 18 | **Pass Rate:** _____%

---

## Checklist – Device 2 (Google Pixel 7 Pro / Android 13)

| ID | Test | Expected | D2 Result | Notes |
|---|---|---|---|---|
| TC-PD-D2-01 | App launches without crash | Opens to harness screen | ☐ PASS ☐ FAIL | |
| TC-PD-D2-02 | Engine Presence: Injected within 3 s | Status card shows "Injected" | ☐ PASS ☐ FAIL | |
| TC-PD-D2-03 | Front camera preview renders | Live video visible | ☐ PASS ☐ FAIL | |
| TC-PD-D2-04 | Frame Processor Plugin: Registered | Status shows "Registered" | ☐ PASS ☐ FAIL | |
| TC-PD-D2-05 | Enrollment: liveness pass → result read | `accepted` field present | ☐ PASS ☐ FAIL | |
| TC-PD-D2-06 | Real face accepted (accuracy gate) | `accepted: true` | ☐ PASS ☐ FAIL | |
| TC-PD-D2-07 | Latency < 1 s | Result visible within 1 s | ☐ PASS ☐ FAIL | |
| TC-PD-D2-08 | Anti-spoof: printed photo rejected | `livenessState: 3` | ☐ PASS ☐ FAIL | |
| TC-PD-D2-09 | SQLCipher smoke test PASS | "SQLCipher smoke test: PASS" | ☐ PASS ☐ FAIL | |
| TC-PD-D2-10 | MMKV smoke test PASS | "MMKV smoke test: PASS" | ☐ PASS ☐ FAIL | |
| TC-PD-D2-11 | Offline mode: no crash | App stable with WiFi off | ☐ PASS ☐ FAIL | |
| TC-PD-D2-12 | verifyChain() passes on clean ledger | No tamper detection error in logs | ☐ PASS ☐ FAIL | |

**Device 2 Score:** _____ / 12 | **Pass Rate:** _____%

---

## Checklist – Device 3 (OnePlus 11 / Android 13)

| ID | Test | Expected | D3 Result | Notes |
|---|---|---|---|---|
| TC-PD-D3-01 | App launches without crash | Opens to harness screen | ☐ PASS ☐ FAIL | |
| TC-PD-D3-02 | Engine Presence: Injected within 3 s | Status card shows "Injected" | ☐ PASS ☐ FAIL | |
| TC-PD-D3-03 | Front camera preview renders | Live video visible | ☐ PASS ☐ FAIL | |
| TC-PD-D3-04 | Frame Processor Plugin: Registered | Status shows "Registered" | ☐ PASS ☐ FAIL | |
| TC-PD-D3-05 | Enrollment: liveness pass → result read | `accepted` field present | ☐ PASS ☐ FAIL | |
| TC-PD-D3-06 | Real face accepted (accuracy gate) | `accepted: true` | ☐ PASS ☐ FAIL | |
| TC-PD-D3-07 | Latency < 1 s | Result visible within 1 s | ☐ PASS ☐ FAIL | |
| TC-PD-D3-08 | Anti-spoof: printed photo rejected | `livenessState: 3` | ☐ PASS ☐ FAIL | |
| TC-PD-D3-09 | SQLCipher smoke test PASS | "SQLCipher smoke test: PASS" | ☐ PASS ☐ FAIL | |
| TC-PD-D3-10 | MMKV smoke test PASS | "MMKV smoke test: PASS" | ☐ PASS ☐ FAIL | |
| TC-PD-D3-11 | Offline mode: no crash | App stable with WiFi off | ☐ PASS ☐ FAIL | |
| TC-PD-D3-12 | verifyChain() passes on clean ledger | No tamper detection error in logs | ☐ PASS ☐ FAIL | |

**Device 3 Score:** _____ / 12 | **Pass Rate:** _____%

---

## Aggregate Physical Device Summary

| Device | Score | Pass Rate | Sign-off |
|---|---|---|---|
| D1 – Samsung S23 Ultra (Android 14) | /18 | % | ☐ |
| D2 – Pixel 7 Pro (Android 13) | /12 | % | ☐ |
| D3 – OnePlus 11 (Android 13) | /12 | % | ☐ |
| **Combined** | **/42** | **%** | |

> [!IMPORTANT]
> **Go threshold:** ≥ 90% pass rate across all 3 devices AND all Go/No-Go criteria met.

---

## ADB Helpful Commands

```powershell
# Install APK
adb -s <SERIAL> install -r android/app/build/outputs/apk/debug/app-debug.apk

# Stream Logcat (filter to app)
adb -s <SERIAL> logcat --pid=$(adb -s <SERIAL> shell pidof com.offlinefaceauth)

# Pull encrypted DB to verify it's not plaintext
adb -s <SERIAL> pull /data/data/com.offlinefaceauth/databases/face_auth.db .
strings face_auth.db | head -20

# Disable/Enable WiFi
adb -s <SERIAL> shell svc wifi disable
adb -s <SERIAL> shell svc wifi enable

# Grant camera permission
adb -s <SERIAL> shell pm grant com.offlinefaceauth android.permission.CAMERA
```
