import type {Migration} from './MigrationRunner';

export const ledgerMonotonicClockMigration: Migration = {
  version: 3,
  name: 'ledger_monotonic_clock_binding',
  statements: [
    `
      ALTER TABLE attendance_ledger
        ADD COLUMN id TEXT;
    `,
    `
      ALTER TABLE attendance_ledger
        ADD COLUMN encrypted_payload TEXT;
    `,
    `
      ALTER TABLE attendance_ledger
        ADD COLUMN prev_hash TEXT;
    `,
    `
      ALTER TABLE attendance_ledger
        ADD COLUMN ts INTEGER;
    `,
    `
      ALTER TABLE attendance_ledger
        ADD COLUMN uptime_ms INTEGER;
    `,
    `
      ALTER TABLE attendance_ledger
        ADD COLUMN event_counter INTEGER;
    `,
    `
      ALTER TABLE attendance_ledger
        ADD COLUMN consent_withdrawn INTEGER NOT NULL DEFAULT 0
          CHECK (consent_withdrawn IN (0, 1));
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
    `
      CREATE TABLE IF NOT EXISTS boot_session_anchors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        wall_ts INTEGER NOT NULL,
        uptime_ms INTEGER NOT NULL,
        event_id TEXT NOT NULL,
        session_hash TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (event_id)
          REFERENCES attendance_ledger(ledger_id)
          ON UPDATE CASCADE
          ON DELETE CASCADE
      );
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_boot_session_anchors_event
        ON boot_session_anchors(event_id);
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_boot_session_anchors_time
        ON boot_session_anchors(wall_ts, uptime_ms);
    `,
  ],
};
