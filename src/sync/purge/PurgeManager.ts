/**
 * PurgeManager.ts
 * Path: src/sync/purge/PurgeManager.ts
 *
 * Phase 2 scope:
 *   Removes DONE items from the in-memory queue after a successful
 *   S3 upload.
 *
 * Retention rules:
 *   DONE       → purged (removed from backing store).
 *   FAILED     → retained (will be retried by SyncWorker).
 *   PROCESSING → retained (upload is in-flight).
 *   PENDING    → retained (not yet attempted).
 *
 * SQLCipher-backed purge, WAL compaction, and ledger-level tombstones
 * are Phase 3 concerns.
 */

import { _inMemoryQueue } from '../queue/OfflineQueueReader';

// ---------------------------------------------------------------------------
// Purge API
// ---------------------------------------------------------------------------

/**
 * Removes all DONE items from the in-memory queue.
 *
 * Items with status FAILED, PROCESSING, or PENDING are left untouched.
 *
 * @returns The number of items that were purged.
 */
export const purgeCompletedItems = (): number => {
  // Identify indices of DONE items (iterate in reverse so splice is safe).
  const doneIndices: number[] = [];

  for (let i = 0; i < _inMemoryQueue.length; i++) {
    if (_inMemoryQueue[i].status === 'DONE') {
      doneIndices.push(i);
    }
  }

  if (doneIndices.length === 0) {
    console.log('[PurgeManager] purgeCompletedItems: nothing to purge.');
    return 0;
  }

  // Remove in reverse order so earlier indices stay valid.
  for (let j = doneIndices.length - 1; j >= 0; j--) {
    const idx = doneIndices[j];
    const removed = _inMemoryQueue.splice(idx, 1)[0];
    console.log(
      `[PurgeManager] purgeCompletedItems: removed item "${removed.id}" (DONE).`,
    );
  }

  console.log(
    `[PurgeManager] purgeCompletedItems: purged ${doneIndices.length} item(s). ` +
      `Remaining queue length: ${_inMemoryQueue.length}.`,
  );

  return doneIndices.length;
};
