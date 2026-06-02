/**
 * OfflineQueue.ts
 * Path: src/sync/queue/OfflineQueue.ts
 *
 * In-memory offline queue with write helpers.
 *
 * Phase 2 scope:
 *   - addItem()    : enqueue a new PENDING item.
 *   - getAllItems() : return a snapshot of the entire queue.
 *
 * The backing store (_inMemoryQueue) lives in OfflineQueueReader so that
 * both the reader and this writer share the same array reference.
 *
 * SQLCipher persistence, WAL strategy, and encryption are Phase 3 concerns.
 */

import { _inMemoryQueue, QueueItem, QueueItemStatus } from './OfflineQueueReader';

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

// ---------------------------------------------------------------------------
// Queue write API
// ---------------------------------------------------------------------------

/**
 * Enqueues a new item with status PENDING.
 *
 * @param payload - The data record to be synced to S3.
 * @returns The newly created QueueItem (already pushed into the backing store).
 */
export const addItem = (payload: Record<string, unknown>): QueueItem => {
  const item: QueueItem = {
    id: generateId(),
    payload,
    enqueuedAt: new Date().toISOString(),
    status: 'PENDING',
    attempts: 0,
  };

  _inMemoryQueue.push(item);

  console.log(
    `[OfflineQueue] addItem: enqueued item "${item.id}" at ${item.enqueuedAt}.`,
  );

  return item;
};

// ---------------------------------------------------------------------------
// Queue read helpers
// ---------------------------------------------------------------------------

/**
 * Returns a shallow snapshot of all items currently in the queue,
 * regardless of their status.
 *
 * The returned array is a copy of the references – mutating the outer array
 * will not affect the backing store, but mutating individual item objects
 * will (intentional, mirrors the PROCESSING-state pattern used by the reader).
 *
 * @returns Snapshot array of all QueueItems.
 */
export const getAllItems = (): QueueItem[] => {
  return [..._inMemoryQueue];
};
