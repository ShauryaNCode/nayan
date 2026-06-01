import type {Migration} from './MigrationRunner';

export const personEmbeddingCryptoMigration: Migration = {
  version: 2,
  name: 'person_embedding_crypto_escrow',
  statements: [
    `
      ALTER TABLE personnel
        ADD COLUMN encrypted_embed TEXT;
    `,
    `
      ALTER TABLE personnel
        ADD COLUMN kek_hw_wrapped TEXT;
    `,
    `
      ALTER TABLE personnel
        ADD COLUMN kek_admin_wrapped TEXT;
    `,
    `
      ALTER TABLE personnel
        ADD COLUMN admin_key_version INTEGER NOT NULL DEFAULT 1;
    `,
    `
      ALTER TABLE personnel
        ADD COLUMN enrollment_ts INTEGER;
    `,
    `
      ALTER TABLE personnel
        ADD COLUMN consent_ts INTEGER;
    `,
    `
      CREATE TABLE IF NOT EXISTS consent_log (
        id TEXT PRIMARY KEY,
        personnel_id TEXT NOT NULL,
        consent_ts INTEGER NOT NULL,
        consent_ver INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (personnel_id)
          REFERENCES personnel(personnel_id)
          ON UPDATE CASCADE
          ON DELETE CASCADE
      );
    `,
    `
      CREATE INDEX IF NOT EXISTS idx_consent_log_personnel
        ON consent_log(personnel_id, consent_ts);
    `,
  ],
};
