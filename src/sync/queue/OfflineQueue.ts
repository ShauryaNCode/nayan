/**
 * OfflineQueue.ts
 * Path: src/sync/queue/OfflineQueue.ts
 *
 * SQLCipher-backed offline queue with write helpers.
 *
 * Phase 3 (Day 6) scope:
 *   - addItem()    : INSERT a new PENDING row into sync_queue.
 *   - getAllItems() : SELECT all rows from sync_queue.
 *
 * The backing store is the sync_queue table in the encrypted
 * SQLCipher database (migration v3).
 */

import { getDatabase } from '../../storage/database/DatabaseManager';
import { QueueItem, QueueItemStatus } from './OfflineQueueReader';

// Re-export types so callers only need one import path.
export type { QueueItem, QueueItemStatus };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generates a simple unique ID for a queue item.
 * Format: "item-<timestamp>-<random-hex>"
 */
const generateId = (): string => {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `item-${ts}-${rand}`;
};

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

// ---------------------------------------------------------------------------
// Queue write API
// ---------------------------------------------------------------------------

/**
 * Enqueues a new item with status PENDING into the sync_queue table.
 *
 * @param payload - The data record to be synced to S3.
 * @returns The newly created QueueItem.
 */
export const addItem = (payload: Record<string, unknown>): QueueItem => {
  const db = getDatabase();
  const id = generateId();
  const now = new Date().toISOString();
  const payloadJson = JSON.stringify(payload);

  db.executeSync(
    `INSERT INTO sync_queue (queue_id, payload_json, status, attempts, created_at, updated_at)
     VALUES (?, ?, 'PENDING', 0, ?, ?);`,
    [id, payloadJson, now, now],
  );

  const item: QueueItem = {
    id,
    payload,
    enqueuedAt: now,
    status: 'PENDING',
    attempts: 0,
  };

  console.log(
    `[OfflineQueue] addItem: enqueued item "${item.id}" at ${item.enqueuedAt}.`,
  );

  return item;
};

// ---------------------------------------------------------------------------
// Queue read helpers
// ---------------------------------------------------------------------------

/**
 * Returns all items currently in the sync_queue table,
 * regardless of their status, ordered by creation time.
 *
 * @returns Array of all QueueItems.
 */
export const getAllItems = (): QueueItem[] => {
  const db = getDatabase();

  const result = db.executeSync(
    `SELECT queue_id, payload_json, status, attempts, created_at, updated_at
     FROM sync_queue
     ORDER BY created_at ASC;`,
  );

  const rows = getRows(result);

  return rows.map((row): QueueItem => {
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
  });
};
