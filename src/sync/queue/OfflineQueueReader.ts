/**
 * OfflineQueueReader.ts
 * Path: src/sync/queue/OfflineQueueReader.ts
 *
 * Reads items from the SQLCipher-backed sync_queue table.
 *
 * Phase 3 (Day 6) scope:
 *   - readNext()         : atomically claim the oldest PENDING item.
 *   - markProcessing()   : mark a specific item as PROCESSING.
 *   - updateStatus()     : set DONE / FAILED on a queue item.
 *   - incrementAttempts() : bump the attempt counter for retry loops.
 *
 * Atomicity guarantee:
 *   readNext() uses BEGIN IMMEDIATE → SELECT → UPDATE → COMMIT
 *   so no concurrent reader can claim the same item.
 */

import { getDatabase } from '../../storage/database/DatabaseManager';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type QueueItemStatus = 'PENDING' | 'PROCESSING' | 'DONE' | 'FAILED';

export interface QueueItem {
  /** Unique identifier for this queue entry. */
  id: string;
  /** Arbitrary payload to be synced (e.g., face-auth event record). */
  payload: Record<string, unknown>;
  /** ISO-8601 timestamp when the item was enqueued. */
  enqueuedAt: string;
  /** Current processing state. */
  status: QueueItemStatus;
  /** Number of upload attempts so far. */
  attempts: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Extracts rows from a QueryResult as an array of keyed objects.
 */
function getRows(
  result: { rows?: unknown },
): Array<Record<string, unknown>> {
  if (Array.isArray((result as any).rows)) {
    return (result as any).rows as Array<Record<string, unknown>>;
  }
  return [];
}

/**
 * Maps a raw DB row to a QueueItem.
 */
function rowToQueueItem(row: Record<string, unknown>): QueueItem {
  const rawPayload = row.payload_json as string;
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawPayload) as Record<string, unknown>;
  } catch {
    payload = { _raw: rawPayload };
  }

  return {
    id: row.queue_id as string,
    payload,
    enqueuedAt: row.created_at as string,
    status: row.status as QueueItemStatus,
    attempts: Number(row.attempts ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Reader API
// ---------------------------------------------------------------------------

/**
 * Atomically reads the next PENDING item from the sync_queue table.
 *
 * Uses BEGIN IMMEDIATE → SELECT → UPDATE → COMMIT to ensure
 * no concurrent reader can claim the same item.
 *
 * The item's status is set to PROCESSING and attempts incremented
 * by 1 before this function returns.
 *
 * @returns The next QueueItem, or `null` when the queue is empty /
 *          all remaining items are already being processed.
 */
export const readNext = (): QueueItem | null => {
  const db = getDatabase();

  try {
    db.executeSync('BEGIN IMMEDIATE;');

    const result = db.executeSync(
      `SELECT queue_id, payload_json, status, attempts, created_at, updated_at
       FROM sync_queue
       WHERE status = 'PENDING'
       ORDER BY created_at ASC
       LIMIT 1;`,
    );

    const rows = getRows(result);
    if (rows.length === 0) {
      db.executeSync('COMMIT;');
      console.log('[OfflineQueueReader] readNext: queue empty or no PENDING items.');
      return null;
    }

    const row = rows[0];
    const queueId = row.queue_id as string;
    const now = new Date().toISOString();

    db.executeSync(
      `UPDATE sync_queue
       SET status = 'PROCESSING',
           attempts = attempts + 1,
           updated_at = ?
       WHERE queue_id = ?;`,
      [now, queueId],
    );

    db.executeSync('COMMIT;');

    const item = rowToQueueItem({
      ...row,
      status: 'PROCESSING',
      attempts: Number(row.attempts ?? 0) + 1,
      updated_at: now,
    });

    console.log(
      `[OfflineQueueReader] readNext: claimed item "${item.id}" ` +
        `(attempt #${item.attempts}).`,
    );

    return item;
  } catch (error) {
    try {
      db.executeSync('ROLLBACK;');
    } catch (_) {
      // Ignore rollback errors; the original failure is clearer.
    }
    console.error('[OfflineQueueReader] readNext: transaction failed.', error);
    throw error;
  }
};

/**
 * Marks a specific queue item as PROCESSING.
 *
 * Uses BEGIN IMMEDIATE to ensure atomicity. Only transitions items
 * whose current status is not already PROCESSING.
 *
 * @param id - The `queue_id` of the item to mark.
 * @returns `true` if the item was found and updated, `false` otherwise.
 */
export const markProcessing = (id: string): boolean => {
  const db = getDatabase();

  try {
    db.executeSync('BEGIN IMMEDIATE;');

    const now = new Date().toISOString();
    const result = db.executeSync(
      `UPDATE sync_queue
       SET status = 'PROCESSING',
           updated_at = ?
       WHERE queue_id = ?
         AND status != 'PROCESSING';`,
      [now, id],
    );

    db.executeSync('COMMIT;');

    const changed = (result.rowsAffected ?? 0) > 0;

    if (changed) {
      console.log(`[OfflineQueueReader] markProcessing: item "${id}" → PROCESSING.`);
    } else {
      console.warn(`[OfflineQueueReader] markProcessing: item "${id}" not found or already PROCESSING.`);
    }

    return changed;
  } catch (error) {
    try {
      db.executeSync('ROLLBACK;');
    } catch (_) {
      // Ignore rollback errors.
    }
    console.error(`[OfflineQueueReader] markProcessing: transaction failed for "${id}".`, error);
    throw error;
  }
};

// ---------------------------------------------------------------------------
// Status mutation helpers (used by SyncWorker)
// ---------------------------------------------------------------------------

/**
 * Updates the status of a queue item (e.g., DONE or FAILED).
 *
 * @param id     - The `queue_id` of the item.
 * @param status - The new status value.
 * @returns `true` if the row was updated, `false` if not found.
 */
export const updateStatus = (id: string, status: QueueItemStatus): boolean => {
  const db = getDatabase();
  const now = new Date().toISOString();

  const result = db.executeSync(
    `UPDATE sync_queue
     SET status = ?,
         updated_at = ?
     WHERE queue_id = ?;`,
    [status, now, id],
  );

  const changed = (result.rowsAffected ?? 0) > 0;

  if (changed) {
    console.log(`[OfflineQueueReader] updateStatus: item "${id}" → ${status}.`);
  } else {
    console.warn(`[OfflineQueueReader] updateStatus: item "${id}" not found.`);
  }

  return changed;
};

/**
 * Increments the attempt counter for a queue item.
 *
 * @param id - The `queue_id` of the item.
 * @returns The new attempt count, or -1 if the item was not found.
 */
export const incrementAttempts = (id: string): number => {
  const db = getDatabase();
  const now = new Date().toISOString();

  db.executeSync(
    `UPDATE sync_queue
     SET attempts = attempts + 1,
         updated_at = ?
     WHERE queue_id = ?;`,
    [now, id],
  );

  // Read back the new value.
  const result = db.executeSync(
    `SELECT attempts FROM sync_queue WHERE queue_id = ?;`,
    [id],
  );

  const rows = getRows(result);
  if (rows.length === 0) {
    console.warn(`[OfflineQueueReader] incrementAttempts: item "${id}" not found.`);
    return -1;
  }

  const newAttempts = Number(rows[0].attempts ?? 0);
  console.log(`[OfflineQueueReader] incrementAttempts: item "${id}" → attempts=${newAttempts}.`);
  return newAttempts;
};
