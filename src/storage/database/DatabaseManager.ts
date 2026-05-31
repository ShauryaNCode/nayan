/**
 * DatabaseManager — Thin wrapper around op-sqlite for NAYAN
 *
 * Phase 0: Basic open/execute/close with SQLCipher encryption.
 * Phase 1 will add: hardware-backed key derivation, WAL mode, migrations.
 */
import {isSQLCipher, open, type DB} from '@op-engineering/op-sqlite';

export interface DatabaseConfig {
  /** Database file name (e.g. 'nayan.db') */
  name: string;
  /** SQLCipher encryption passphrase */
  encryptionKey: string;
}

let _db: DB | null = null;

export interface DatabasePragmaState {
  journalMode: string;
  walAutocheckpoint: number;
}

export function isSQLCipherEnabled(): boolean {
  return isSQLCipher();
}

function getFirstRow(rows: unknown): any | undefined {
  return Array.isArray(rows) ? rows[0] : undefined;
}

export function configurePhase0Pragmas(db: DB): DatabasePragmaState {
  const journalModeResult = db.executeSync('PRAGMA journal_mode=WAL;');
  db.executeSync('PRAGMA synchronous=NORMAL;');
  const walAutocheckpointResult = db.executeSync(
    'PRAGMA wal_autocheckpoint=100;',
  );

  const journalModeRow = getFirstRow(journalModeResult.rows);
  const walAutocheckpointRow = getFirstRow(walAutocheckpointResult.rows);

  return {
    journalMode: String(
      journalModeRow?.journal_mode ?? journalModeRow?.[0] ?? 'unknown',
    ).toLowerCase(),
    walAutocheckpoint: Number(
      walAutocheckpointRow?.wal_autocheckpoint ??
        walAutocheckpointRow?.[0] ??
        0,
    ),
  };
}

/**
 * Open an encrypted SQLCipher database.
 * In Phase 0, the encryption key is passed directly.
 * Phase 1 will derive it from Android Keystore / iOS Secure Enclave.
 */
export function openDatabase(config: DatabaseConfig): DB {
  if (!config.encryptionKey.trim()) {
    throw new Error('[DatabaseManager] SQLCipher encryption key is required.');
  }

  if (!isSQLCipherEnabled()) {
    throw new Error(
      '[DatabaseManager] op-sqlite was not compiled with SQLCipher. ' +
        'Set "op-sqlite": {"sqlcipher": true}, reinstall native deps, and rebuild.',
    );
  }

  if (_db) {
    console.warn(
      '[DatabaseManager] Database already open, returning existing instance',
    );
    return _db;
  }

  _db = open({
    name: config.name,
    encryptionKey: config.encryptionKey,
  });

  const pragmaState = configurePhase0Pragmas(_db);

  console.log(
    `[DatabaseManager] Opened encrypted database: ${config.name} ` +
      `(journal_mode=${pragmaState.journalMode}, ` +
      `wal_autocheckpoint=${pragmaState.walAutocheckpoint})`,
  );
  return _db;
}

/**
 * Get the current database instance.
 * Throws if no database has been opened.
 */
export function getDatabase(): DB {
  if (!_db) {
    throw new Error(
      '[DatabaseManager] No database open. Call openDatabase() first.',
    );
  }
  return _db;
}

/**
 * Close the database and release resources.
 */
export function closeDatabase(): void {
  if (_db) {
    _db.close();
    _db = null;
    console.log('[DatabaseManager] Database closed');
  }
}

/**
 * Check if a database is currently open.
 */
export function isDatabaseOpen(): boolean {
  return _db !== null;
}
