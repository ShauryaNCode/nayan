import type {Migration} from './MigrationRunner';

export const erasureLedgerSupportMigration: Migration = {
  version: 5,
  name: 'erasure_ledger_support',
  statements: [
    `
      DROP TABLE IF EXISTS attendance_ledger_t36;
    `,
    `
      CREATE TABLE attendance_ledger_t36 (
        ledger_id TEXT PRIMARY KEY,
        personnel_id TEXT,
        event_type TEXT NOT NULL
          CHECK (event_type IN ('check_in', 'check_out', 'verification', 'erasure')),
        captured_at TEXT NOT NULL,
        device_id TEXT NOT NULL,
        confidence REAL,
        liveness_score REAL,
        payload_json TEXT NOT NULL,
        payload_hash TEXT,
        previous_hash TEXT NOT NULL,
        current_hash TEXT NOT NULL UNIQUE,
        chain_index INTEGER NOT NULL UNIQUE,
        synced INTEGER NOT NULL DEFAULT 0 CHECK (synced IN (0, 1)),
        synced_at TEXT,
        created_at TEXT NOT NULL,
        id TEXT,
        encrypted_payload TEXT,
        prev_hash TEXT,
        ts INTEGER,
        uptime_ms INTEGER,
        event_counter INTEGER,
        consent_withdrawn INTEGER NOT NULL DEFAULT 0
          CHECK (consent_withdrawn IN (0, 1))
      );
    `,
    `
      INSERT INTO attendance_ledger_t36 (
        ledger_id,
        personnel_id,
        event_type,
        captured_at,
        device_id,
        confidence,
        liveness_score,
        payload_json,
        payload_hash,
        previous_hash,
        current_hash,
        chain_index,
        synced,
        synced_at,
        created_at,
        id,
        encrypted_payload,
        prev_hash,
        ts,
        uptime_ms,
        event_counter,
        consent_withdrawn
      )
      SELECT
        ledger_id,
        personnel_id,
        event_type,
        captured_at,
        device_id,
        confidence,
        liveness_score,
        payload_json,
        NULL,
        previous_hash,
        current_hash,
        chain_index,
        synced,
        synced_at,
        created_at,
        id,
        encrypted_payload,
        prev_hash,
        ts,
        uptime_ms,
        event_counter,
        consent_withdrawn
      FROM attendance_ledger;
    `,
    `
      DROP TABLE attendance_ledger;
    `,
    `
      ALTER TABLE attendance_ledger_t36 RENAME TO attendance_ledger;
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_attendance_ledger_synced_chain
        ON attendance_ledger(synced, chain_index);
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_attendance_ledger_personnel_time
        ON attendance_ledger(personnel_id, captured_at);
    `,
    `
      CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_ledger_event_counter
        ON attendance_ledger(event_counter)
        WHERE event_counter IS NOT NULL;
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_attendance_ledger_synced_event_counter
        ON attendance_ledger(synced, event_counter);
    `,
  ],
};
