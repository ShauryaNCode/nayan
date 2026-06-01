/**
 * OfflineQueueReader.ts
 * Path: src/sync/queue/OfflineQueueReader.ts
 *
 * Reads items from the in-memory offline queue one at a time.
 *
 * Phase 1 scope: temporary in-memory queue only.
 * SQLCipher-backed persistence, WAL strategy, and batch selection
 * are Phase 2 concerns.
 *
 * Atomicity guarantee:
 *   readNext() pops the head item and immediately marks it
 *   PROCESSING before returning, so no concurrent reader can
 *   claim the same item.
 */

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
// In-memory store (Phase 1 only)
// ---------------------------------------------------------------------------

/**
 * The backing store.  Exported so tests / the queue writer stub can
 * seed items without going through the real write path.
 *
 * NOTE: Do NOT import this directly in production code – use the
 *       reader functions below.
 */
export const _inMemoryQueue: QueueItem[] = [
  // Seed a few realistic-looking items so Phase 1 can be exercised
  // without a real queue writer.
  {
    id: 'item-seed-001',
    payload: { event: 'face_auth_attempt', userId: 'usr_demo_1', score: 0.97 },
    enqueuedAt: new Date().toISOString(),
    status: 'PENDING',
    attempts: 0,
  },
  {
    id: 'item-seed-002',
    payload: { event: 'face_auth_attempt', userId: 'usr_demo_2', score: 0.88 },
    enqueuedAt: new Date().toISOString(),
    status: 'PENDING',
    attempts: 0,
  },
];

// ---------------------------------------------------------------------------
// Reader API
// ---------------------------------------------------------------------------

/**
 * Atomically reads the next PENDING item from the queue.
 *
 * The item's status is immediately set to PROCESSING before this
 * function returns, preventing double-processing by concurrent callers.
 *
 * @returns The next QueueItem, or `null` when the queue is empty /
 *          all remaining items are already being processed.
 */
export const readNext = (): QueueItem | null => {
  const item = _inMemoryQueue.find((i) => i.status === 'PENDING');

  if (!item) {
    console.log('[OfflineQueueReader] readNext: queue empty or no PENDING items.');
    return null;
  }

  // Mark atomically (single-threaded JS event loop guarantees this).
  item.status = 'PROCESSING';
  item.attempts += 1;

  console.log(
    `[OfflineQueueReader] readNext: claimed item "${item.id}" ` +
      `(attempt #${item.attempts}).`,
  );

  return item;
};

/**
 * Marks a specific queue item as PROCESSING.
 *
 * Useful when an item was returned by readNext() but an upstream
 * caller needs to explicitly (re-)mark it after a deserialization
 * round-trip.
 *
 * @param id - The `id` of the QueueItem to mark.
 * @returns `true` if the item was found and updated, `false` otherwise.
 */
export const markProcessing = (id: string): boolean => {
  const item = _inMemoryQueue.find((i) => i.id === id);

  if (!item) {
    console.warn(`[OfflineQueueReader] markProcessing: item "${id}" not found.`);
    return false;
  }

  item.status = 'PROCESSING';
  console.log(`[OfflineQueueReader] markProcessing: item "${id}" → PROCESSING.`);
  return true;
};
