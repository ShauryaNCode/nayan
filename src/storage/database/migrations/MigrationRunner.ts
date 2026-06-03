import type {
  DB,
  QueryResult,
} from '@op-engineering/op-sqlite';

import {initialSchemaMigration} from './001_initial_schema';
import {personEmbeddingCryptoMigration} from './002_person_embedding_crypto';
import {syncQueueMigration} from './003_sync_queue';

export interface Migration {
  version: number;
  name: string;
  statements: string[];
}

export interface AppliedMigration {
  version: number;
  name: string;
  appliedAt: string;
}

export interface MigrationRunnerResult {
  applied: AppliedMigration[];
  latestVersion: number;
}

export const migrations: Migration[] = [
  initialSchemaMigration,
  personEmbeddingCryptoMigration,
  syncQueueMigration,
];

const CREATE_MIGRATIONS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  );
`;

function getRows(result: QueryResult): Array<Record<string, unknown>> {
  return Array.isArray(result.rows)
    ? (result.rows as Array<Record<string, unknown>>)
    : [];
}

export function getAppliedMigrationVersions(db: DB): Set<number> {
  db.executeSync(CREATE_MIGRATIONS_TABLE_SQL);

  const result = db.executeSync(
    'SELECT version FROM schema_migrations ORDER BY version ASC;',
  );

  return new Set(
    getRows(result)
      .map((row) => Number(row.version))
      .filter((version) => Number.isInteger(version)),
  );
}

export function runMigrations(
  db: DB,
  migrationList: Migration[] = migrations,
): MigrationRunnerResult {
  const sortedMigrations = [...migrationList].sort(
    (a, b) => a.version - b.version,
  );
  const appliedVersions = getAppliedMigrationVersions(db);
  const applied: AppliedMigration[] = [];

  for (const migration of sortedMigrations) {
    if (appliedVersions.has(migration.version)) {
      continue;
    }

    const appliedAt = new Date().toISOString();

    try {
      db.executeSync('BEGIN IMMEDIATE;');

      for (const statement of migration.statements) {
        const sql = statement.trim();
        if (sql.length > 0) {
          db.executeSync(sql);
        }
      }

      db.executeSync(
        `
          INSERT INTO schema_migrations (version, name, applied_at)
          VALUES (?, ?, ?);
        `,
        [migration.version, migration.name, appliedAt],
      );
      db.executeSync('COMMIT;');

      applied.push({
        version: migration.version,
        name: migration.name,
        appliedAt,
      });
    } catch (error) {
      try {
        db.executeSync('ROLLBACK;');
      } catch (_) {
        // Ignore rollback errors; the original migration failure is clearer.
      }
      throw error;
    }
  }

  return {
    applied,
    latestVersion:
      sortedMigrations.length > 0
        ? sortedMigrations[sortedMigrations.length - 1].version
        : 0,
  };
}
