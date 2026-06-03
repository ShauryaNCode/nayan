/**
 * SyncWorker.ts
 * Path: src/sync/aws/SyncWorker.ts
 *
 * Phase 2 scope (preserved):
 *   Drives the upload loop for the offline queue.
 *
 *   processQueue():
 *     1. Reads the next PENDING item via OfflineQueueReader.readNext().
 *     2. Attempts upload via S3Uploader.uploadToS3().
 *     3. On success  → marks item status = DONE via SQL.
 *     4. On failure  → marks item status = FAILED via SQL.
 *        Re-enqueues as PENDING and waits BackoffEngine.getDelay(attempt)
 *        before the next attempt.  Maximum 5 attempts per item.
 *     5. Continues until no PENDING items remain.
 *
 * Phase 3 (Day 6) changes:
 *   - Status transitions now use updateStatus() / incrementAttempts()
 *     which write through to the SQLCipher sync_queue table.
 *   - Local attempt counter tracks retry state within the loop.
 *
 * Constraints:
 *   - No background services.
 *   - No WorkManager / Headless JS.
 *   - No conflict resolution (ConflictResolver is Phase 3).
 *   - No multipart uploads.
 *
 * Background workers, multipart uploads, and conflict resolution
 * are future concerns.
 */

import { getDelay } from '../connectivity/BackoffEngine';
import {
  readNext,
  updateStatus,
  incrementAttempts,
  QueueItem,
} from '../queue/OfflineQueueReader';
import { uploadToS3 } from './S3Uploader';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of upload attempts per queue item before giving up. */
const MAX_RETRIES = 5;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Returns a promise that resolves after `ms` milliseconds.
 * Used to honour the BackoffEngine delay between retries.
 */
const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Attempts to upload a single item, retrying on failure with exponential
 * backoff, up to MAX_RETRIES attempts total.
 *
 * Status transitions (via SQLCipher):
 *   PROCESSING → DONE    (success on any attempt)
 *   PROCESSING → FAILED  (all attempts exhausted)
 *
 * The item's `attempts` counter was already incremented by readNext().
 * A local counter tracks the attempt number within this loop, and
 * incrementAttempts() writes back to the DB on each retry.
 *
 * @param item - The QueueItem currently in PROCESSING state.
 * @returns The final status of the item after all attempts.
 */
const uploadWithRetry = async (item: QueueItem): Promise<'DONE' | 'FAILED'> => {
  // Local attempt counter, initialised from the DB value set by readNext().
  let currentAttempt = item.attempts;

  while (currentAttempt <= MAX_RETRIES) {
    console.log(
      `[SyncWorker] uploadWithRetry: item "${item.id}" ` +
        `attempt ${currentAttempt}/${MAX_RETRIES}.`,
    );

    const result = await uploadToS3(item);

    if (result.success) {
      updateStatus(item.id, 'DONE');
      console.log(
        `[SyncWorker] uploadWithRetry: item "${item.id}" → DONE ` +
          `(ETag=${result.eTag}).`,
      );
      return 'DONE';
    }

    // Upload failed.
    console.warn(
      `[SyncWorker] uploadWithRetry: item "${item.id}" attempt ` +
        `${currentAttempt} failed. Error: ${result.error}`,
    );

    if (currentAttempt >= MAX_RETRIES) {
      // All retries exhausted – give up.
      updateStatus(item.id, 'FAILED');
      console.error(
        `[SyncWorker] uploadWithRetry: item "${item.id}" → FAILED ` +
          `after ${MAX_RETRIES} attempts.`,
      );
      return 'FAILED';
    }

    // Calculate backoff delay for next attempt.
    const delayMs = getDelay(currentAttempt);
    console.log(
      `[SyncWorker] uploadWithRetry: waiting ${delayMs} ms before retry ` +
        `(attempt ${currentAttempt + 1}).`,
    );

    await sleep(delayMs);

    // Increment attempt counter in DB and update local tracker.
    currentAttempt = incrementAttempts(item.id);
    if (currentAttempt < 0) {
      // Item was not found in DB – bail.
      console.error(
        `[SyncWorker] uploadWithRetry: item "${item.id}" disappeared from DB.`,
      );
      return 'FAILED';
    }
  }

  // Should not be reached, but guard against it.
  return 'FAILED';
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Processes all PENDING items in the offline queue sequentially.
 *
 * For each item:
 *   1. Reads it via readNext() (which marks it PROCESSING in SQLCipher).
 *   2. Calls uploadWithRetry() to attempt the S3 upload with backoff.
 *   3. The item ends as either DONE or FAILED (persisted in SQLCipher).
 *
 * The loop terminates when readNext() returns null (no more PENDING items).
 *
 * This function is intentionally synchronous in control flow – it awaits
 * each item fully before moving to the next to keep ordering deterministic
 * and avoid concurrent writes to the same queue state.
 *
 * @returns A promise that resolves with a summary of the processing run.
 */
export const processQueue = async (): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
}> => {
  console.log('[SyncWorker] processQueue: starting queue drain loop.');

  let processed = 0;
  let succeeded = 0;
  let failed = 0;

  let item: QueueItem | null;

  // eslint-disable-next-line no-cond-assign
  while ((item = readNext()) !== null) {
    processed += 1;

    const finalStatus = await uploadWithRetry(item);

    if (finalStatus === 'DONE') {
      succeeded += 1;
    } else {
      failed += 1;
    }
  }

  console.log(
    `[SyncWorker] processQueue: finished. ` +
      `processed=${processed}, succeeded=${succeeded}, failed=${failed}.`,
  );

  return { processed, succeeded, failed };
};
