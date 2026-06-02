import type {
  DB,
} from '@op-engineering/op-sqlite';

import {initialSchemaMigration} from './001_initial_schema';
import {personEmbeddingCryptoMigration} from './002_person_embedding_crypto';
import {executeSql, getRows} from '../SQLiteCompat';

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
];

const CREATE_MIGRATIONS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  );
`;

export function getAppliedMigrationVersions(db: DB): Set<number> {
  executeSql(db, CREATE_MIGRATIONS_TABLE_SQL);

  const result = executeSql(
    db,
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
      executeSql(db, 'BEGIN IMMEDIATE;');

      for (const statement of migration.statements) {
        const sql = statement.trim();
        if (sql.length > 0) {
          executeSql(db, sql);
        }
      }

      executeSql(
        db,
        `
          INSERT INTO schema_migrations (version, name, applied_at)
          VALUES (?, ?, ?);
        `,
        [migration.version, migration.name, appliedAt],
      );
      executeSql(db, 'COMMIT;');

      applied.push({
        version: migration.version,
        name: migration.name,
        appliedAt,
      });
    } catch (error) {
      try {
        executeSql(db, 'ROLLBACK;');
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
