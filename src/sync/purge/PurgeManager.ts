/**
 * PurgeManager.ts
 * Path: src/sync/purge/PurgeManager.ts
 *
 * Phase 3 (Day 6) scope:
 *   Removes DONE items from the sync_queue table after a successful
 *   S3 upload.
 *
 * Retention rules:
 *   DONE       → purged (deleted from sync_queue).
 *   FAILED     → retained (will be retried by SyncWorker).
 *   PROCESSING → retained (upload is in-flight).
 *   PENDING    → retained (not yet attempted).
 *
 * WAL compaction and ledger-level tombstones are future concerns.
 */

import { getDatabase } from '../../storage/database/DatabaseManager';

// ---------------------------------------------------------------------------
// Purge API
// ---------------------------------------------------------------------------

/**
 * Removes all DONE items from the sync_queue table.
 *
 * Items with status FAILED, PROCESSING, or PENDING are left untouched.
 *
 * @returns The number of items that were purged.
 */
export const purgeCompletedItems = (): number => {
  const db = getDatabase();

  const result = db.executeSync(
    `DELETE FROM sync_queue WHERE status = 'DONE';`,
  );

  const purged = result.rowsAffected ?? 0;

  if (purged === 0) {
    console.log('[PurgeManager] purgeCompletedItems: nothing to purge.');
  } else {
    console.log(
      `[PurgeManager] purgeCompletedItems: purged ${purged} item(s).`,
    );
  }

  return purged;
};
