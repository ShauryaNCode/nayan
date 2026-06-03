import type {Migration} from './MigrationRunner';

/**
 * Migration v3 — sync_queue table
 *
 * Provides SQLCipher-backed persistence for the M4 offline queue.
 * Replaces the in-memory _inMemoryQueue array.
 *
 * Columns:
 *   queue_id     – unique item identifier (TEXT PK)
 *   payload_json – serialised JSON payload for S3 upload
 *   status       – lifecycle state: PENDING → PROCESSING → DONE / FAILED
 *   attempts     – number of upload attempts so far
 *   created_at   – ISO-8601 enqueue timestamp
 *   updated_at   – ISO-8601 last-modified timestamp
 */
export const syncQueueMigration: Migration = {
  version: 3,
  name: 'sync_queue',
  statements: [
    `
      CREATE TABLE IF NOT EXISTS sync_queue (
        queue_id     TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL,
        status       TEXT NOT NULL
          CHECK (status IN ('PENDING', 'PROCESSING', 'DONE', 'FAILED')),
        attempts     INTEGER NOT NULL DEFAULT 0,
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL
      );
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_sync_queue_status
        ON sync_queue(status, created_at);
    `,
  ],
};
