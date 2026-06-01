import type {Migration} from './MigrationRunner';

export const initialSchemaMigration: Migration = {
  version: 1,
  name: 'initial_secure_storage_schema',
  statements: [
    `
      CREATE TABLE IF NOT EXISTS personnel (
        personnel_id TEXT PRIMARY KEY,
        external_id TEXT UNIQUE,
        full_name TEXT NOT NULL,
        role TEXT,
        enrollment_status TEXT NOT NULL DEFAULT 'active'
          CHECK (enrollment_status IN ('active', 'pending_deletion', 'deleted')),
        embedding_ciphertext BLOB,
        embedding_iv BLOB,
        embedding_tag BLOB,
        embedding_key_version INTEGER NOT NULL DEFAULT 1,
        lsh_signature TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );
    `,
    `
      CREATE TABLE IF NOT EXISTS attendance_ledger (
        ledger_id TEXT PRIMARY KEY,
        personnel_id TEXT NOT NULL,
        event_type TEXT NOT NULL
          CHECK (event_type IN ('check_in', 'check_out', 'verification')),
        captured_at TEXT NOT NULL,
        device_id TEXT NOT NULL,
        confidence REAL,
        liveness_score REAL,
        payload_json TEXT NOT NULL,
        previous_hash TEXT NOT NULL,
        current_hash TEXT NOT NULL UNIQUE,
        chain_index INTEGER NOT NULL UNIQUE,
        synced INTEGER NOT NULL DEFAULT 0 CHECK (synced IN (0, 1)),
        synced_at TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (personnel_id)
          REFERENCES personnel(personnel_id)
          ON UPDATE CASCADE
          ON DELETE RESTRICT
      );
    `,
    `
      CREATE TABLE IF NOT EXISTS lsh_index (
        bucket_key TEXT NOT NULL,
        personnel_id TEXT NOT NULL,
        band_index INTEGER NOT NULL,
        signature TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (bucket_key, personnel_id, band_index),
        FOREIGN KEY (personnel_id)
          REFERENCES personnel(personnel_id)
          ON UPDATE CASCADE
          ON DELETE CASCADE
      );
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_personnel_status
        ON personnel(enrollment_status, updated_at);
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
      CREATE INDEX IF NOT EXISTS idx_lsh_index_personnel
        ON lsh_index(personnel_id);
    `,
  ],
};
