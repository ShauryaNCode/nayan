# Path: OfflineFaceAuth/src/sync/connectivity/BackoffEngine.ts
# Purpose: Exponential backoff retry engine with initial 5s, max 5min, plus/minus 20% jitter, state persisted in MMKV across app restarts.
