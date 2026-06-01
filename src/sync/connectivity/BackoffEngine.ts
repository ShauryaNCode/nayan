/**
 * BackoffEngine.ts
 * Path: src/sync/connectivity/BackoffEngine.ts
 *
 * Exponential backoff delay calculator for retry logic.
 *
 * Delay schedule (base 1 000 ms, factor ×2, cap 30 000 ms):
 *   attempt 1 →  1 000 ms
 *   attempt 2 →  2 000 ms
 *   attempt 3 →  4 000 ms
 *   attempt 4 →  8 000 ms
 *   attempt 5 → 16 000 ms
 *   attempt 6 → 30 000 ms  (capped)
 *
 * Phase 1 scope: deterministic delay only.
 * Jitter and MMKV persistence are Phase 2 concerns.
 */

const BASE_DELAY_MS = 1_000;
const BACKOFF_FACTOR = 2;
const MAX_DELAY_MS = 30_000;

/**
 * Returns the backoff delay in milliseconds for a given retry attempt.
 *
 * @param attempt - 1-based attempt number (1 = first retry).
 * @returns Delay in milliseconds, capped at MAX_DELAY_MS (30 000).
 */
export const getDelay = (attempt: number): number => {
  if (attempt < 1) {
    return BASE_DELAY_MS;
  }

  const rawDelay = BASE_DELAY_MS * Math.pow(BACKOFF_FACTOR, attempt - 1);
  return Math.min(rawDelay, MAX_DELAY_MS);
};
