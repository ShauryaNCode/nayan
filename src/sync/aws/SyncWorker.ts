/**
 * SyncWorker.ts
 * Path: src/sync/aws/SyncWorker.ts
 *
 * Phase 2 scope:
 *   Drives the upload loop for the in-memory offline queue.
 *
 *   processQueue():
 *     1. Reads the next PENDING item via OfflineQueueReader.readNext().
 *     2. Attempts upload via S3Uploader.uploadToS3().
 *     3. On success  → marks item status = DONE.
 *     4. On failure  → marks item status = FAILED.
 *        Re-enqueues as PENDING and waits BackoffEngine.getDelay(attempt)
 *        before the next attempt.  Maximum 5 attempts per item.
 *     5. Continues until no PENDING items remain.
 *
 * Constraints (Phase 2):
 *   - No background services.
 *   - No WorkManager / Headless JS.
 *   - No conflict resolution (ConflictResolver is Phase 3).
 *   - No multipart uploads.
 *
 * Background workers, multipart uploads, and conflict resolution
 * are Phase 3 concerns.
 */

import { getDelay } from '../connectivity/BackoffEngine';
import { readNext, QueueItem } from '../queue/OfflineQueueReader';
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
 * Status transitions:
 *   PROCESSING → DONE    (success on any attempt)
 *   PROCESSING → FAILED  (all attempts exhausted)
 *
 * The item's `attempts` counter is already incremented by readNext().
 * Additional retry attempts increment it here manually so the backoff
 * delay reflects the true attempt number.
 *
 * @param item - The QueueItem currently in PROCESSING state.
 */
const uploadWithRetry = async (item: QueueItem): Promise<void> => {
  // item.attempts was incremented to 1 by readNext() for the first attempt.
  while (item.attempts <= MAX_RETRIES) {
    console.log(
      `[SyncWorker] uploadWithRetry: item "${item.id}" ` +
        `attempt ${item.attempts}/${MAX_RETRIES}.`,
    );

    const result = await uploadToS3(item);

    if (result.success) {
      item.status = 'DONE';
      console.log(
        `[SyncWorker] uploadWithRetry: item "${item.id}" → DONE ` +
          `(ETag=${result.eTag}).`,
      );
      return;
    }

    // Upload failed.
    console.warn(
      `[SyncWorker] uploadWithRetry: item "${item.id}" attempt ` +
        `${item.attempts} failed. Error: ${result.error}`,
    );

    if (item.attempts >= MAX_RETRIES) {
      // All retries exhausted – give up.
      item.status = 'FAILED';
      console.error(
        `[SyncWorker] uploadWithRetry: item "${item.id}" → FAILED ` +
          `after ${MAX_RETRIES} attempts.`,
      );
      return;
    }

    // Calculate backoff delay for next attempt.
    const delayMs = getDelay(item.attempts);
    console.log(
      `[SyncWorker] uploadWithRetry: waiting ${delayMs} ms before retry ` +
        `(attempt ${item.attempts + 1}).`,
    );

    await sleep(delayMs);

    // Increment attempt counter and re-mark as PROCESSING for the next round.
    item.attempts += 1;
    item.status = 'PROCESSING';
  }
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Processes all PENDING items in the offline queue sequentially.
 *
 * For each item:
 *   1. Reads it via readNext() (which marks it PROCESSING).
 *   2. Calls uploadWithRetry() to attempt the S3 upload with backoff.
 *   3. The item ends as either DONE or FAILED.
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

    await uploadWithRetry(item);

    if (item.status === 'DONE') {
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
