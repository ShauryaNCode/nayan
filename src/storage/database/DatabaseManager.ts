import {
  isSQLCipher,
  open,
  type DB,
  type QueryResult,
} from '@op-engineering/op-sqlite';

import {
  deriveSQLCipherPassphrase,
  type SQLCipherPassphraseResult,
} from '../encryption/KeyDerivation';
import {
  runMigrations,
  type MigrationRunnerResult,
} from './migrations/MigrationRunner';

export const DEFAULT_DATABASE_NAME = 'face_auth.db';

export interface DatabaseConfig {
  name?: string;
  location?: string;
  encryptionKey: string;
  runMigrations?: boolean;
}

export interface OpenProductionDatabaseConfig {
  name?: string;
  location?: string;
  runMigrations?: boolean;
}

export interface DatabasePragmaState {
  journalMode: string;
  synchronous: number;
  walAutocheckpoint: number;
  cacheSizeKiB: number;
  foreignKeys: boolean;
}

export interface DatabaseOpenResult {
  db: DB;
  pragmaState: DatabasePragmaState;
  migrationResult?: MigrationRunnerResult;
  passphrase?: SQLCipherPassphraseResult;
}

let currentDb: DB | null = null;
let currentOpenResult: DatabaseOpenResult | null = null;

export function isSQLCipherEnabled(): boolean {
  return isSQLCipher();
}

function getFirstRow(result: QueryResult): Record<string, unknown> | undefined {
  if (Array.isArray(result.rows)) {
    return result.rows[0] as Record<string, unknown> | undefined;
  }

  return undefined;
}

function readNumber(
  row: Record<string, unknown> | undefined,
  namedColumn: string,
): number {
  if (!row) {
    return 0;
  }

  const indexedRow = row as Record<string | number, unknown>;
  const value = row[namedColumn] ?? indexedRow[0];
  return Number(value ?? 0);
}

export function configureDatabasePragmas(db: DB): DatabasePragmaState {
  const journalModeResult = db.executeSync('PRAGMA journal_mode=WAL;');
  db.executeSync('PRAGMA synchronous=NORMAL;');
  const walAutocheckpointResult = db.executeSync(
    'PRAGMA wal_autocheckpoint=100;',
  );
  db.executeSync('PRAGMA cache_size=-8000;');
  db.executeSync('PRAGMA foreign_keys=ON;');

  const synchronousResult = db.executeSync('PRAGMA synchronous;');
  const cacheSizeResult = db.executeSync('PRAGMA cache_size;');
  const foreignKeysResult = db.executeSync('PRAGMA foreign_keys;');

  const journalModeRow = getFirstRow(journalModeResult);
  const walAutocheckpointRow = getFirstRow(walAutocheckpointResult);
  const synchronousRow = getFirstRow(synchronousResult);
  const cacheSizeRow = getFirstRow(cacheSizeResult);
  const foreignKeysRow = getFirstRow(foreignKeysResult);

  return {
    journalMode: String(
      journalModeRow?.journal_mode ?? journalModeRow?.[0] ?? 'unknown',
    ).toLowerCase(),
    synchronous: readNumber(synchronousRow, 'synchronous'),
    walAutocheckpoint: readNumber(
      walAutocheckpointRow,
      'wal_autocheckpoint',
    ),
    cacheSizeKiB: readNumber(cacheSizeRow, 'cache_size'),
    foreignKeys: readNumber(foreignKeysRow, 'foreign_keys') === 1,
  };
}

export const configurePhase0Pragmas = configureDatabasePragmas;

function assertPragmaState(state: DatabasePragmaState): void {
  if (state.journalMode !== 'wal') {
    throw new Error(
      `[DatabaseManager] WAL mode was not enabled (journal_mode=${state.journalMode}).`,
    );
  }

  if (state.synchronous !== 1) {
    throw new Error(
      `[DatabaseManager] synchronous=NORMAL was not applied (value=${state.synchronous}).`,
    );
  }

  if (state.walAutocheckpoint !== 100) {
    throw new Error(
      `[DatabaseManager] wal_autocheckpoint=100 was not applied (value=${state.walAutocheckpoint}).`,
    );
  }

  if (state.cacheSizeKiB !== -8000) {
    throw new Error(
      `[DatabaseManager] cache_size=-8000 was not applied (value=${state.cacheSizeKiB}).`,
    );
  }

  if (!state.foreignKeys) {
    throw new Error('[DatabaseManager] foreign_keys=ON was not applied.');
  }
}

function assertCanOpenEncryptedDatabase(): void {
  if (!isSQLCipherEnabled()) {
    throw new Error(
      '[DatabaseManager] op-sqlite was not compiled with SQLCipher. ' +
        'Set "op-sqlite": {"sqlcipher": true}, reinstall native deps, and rebuild.',
    );
  }
}

export function openDatabase(config: DatabaseConfig): DB {
  return openDatabaseWithState(config).db;
}

export function openDatabaseWithState(config: DatabaseConfig): DatabaseOpenResult {
  const databaseName = config.name ?? DEFAULT_DATABASE_NAME;

  if (!config.encryptionKey.trim()) {
    throw new Error('[DatabaseManager] SQLCipher encryption key is required.');
  }

  assertCanOpenEncryptedDatabase();

  if (currentOpenResult) {
    console.warn(
      '[DatabaseManager] Database already open, returning existing instance',
    );
    return currentOpenResult;
  }

  const db = open({
    name: databaseName,
    location: config.location,
    encryptionKey: config.encryptionKey,
  });

  currentDb = db;

  const pragmaState = configureDatabasePragmas(db);
  assertPragmaState(pragmaState);

  const migrationResult =
    config.runMigrations === false ? undefined : runMigrations(db);

  currentOpenResult = {
    db,
    pragmaState,
    migrationResult,
  };

  console.log(
    `[DatabaseManager] Opened encrypted database: ${databaseName} ` +
      `(journal_mode=${pragmaState.journalMode}, ` +
      `synchronous=${pragmaState.synchronous}, ` +
      `wal_autocheckpoint=${pragmaState.walAutocheckpoint}, ` +
      `cache_size=${pragmaState.cacheSizeKiB}, ` +
      `foreign_keys=${String(pragmaState.foreignKeys)}, ` +
      `migrations=${migrationResult?.latestVersion ?? 'skipped'})`,
  );

  return currentOpenResult;
}

export async function openProductionDatabase(
  config: OpenProductionDatabaseConfig = {},
): Promise<DB> {
  return (await openProductionDatabaseWithState(config)).db;
}

export async function openProductionDatabaseWithState(
  config: OpenProductionDatabaseConfig = {},
): Promise<DatabaseOpenResult> {
  if (currentOpenResult) {
    return currentOpenResult;
  }

  const passphrase = await deriveSQLCipherPassphrase();
  const openResult = openDatabaseWithState({
    name: config.name ?? DEFAULT_DATABASE_NAME,
    location: config.location,
    encryptionKey: passphrase.passphrase,
    runMigrations: config.runMigrations,
  });

  currentOpenResult = {
    ...openResult,
    passphrase,
  };

  return currentOpenResult;
}

export function getDatabase(): DB {
  if (!currentDb) {
    throw new Error(
      '[DatabaseManager] No database open. Call openProductionDatabase() first.',
    );
  }
  return currentDb;
}

export function getDatabaseOpenState(): DatabaseOpenResult | null {
  return currentOpenResult;
}

export function closeDatabase(): void {
  if (currentDb) {
    currentDb.close();
    currentDb = null;
    currentOpenResult = null;
    console.log('[DatabaseManager] Database closed');
  }
}

export function isDatabaseOpen(): boolean {
  return currentDb !== null;
}
