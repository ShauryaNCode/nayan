/**
 * DatabaseManager — Thin wrapper around op-sqlite for NAYAN
 *
 * Phase 0: Basic open/execute/close with SQLCipher encryption.
 * Phase 1 will add: hardware-backed key derivation, WAL mode, migrations.
 */
import {
  isSQLCipher,
  open,
  type OPSQLiteConnection as DB,
} from '@op-engineering/op-sqlite';

export interface DatabaseConfig {
  /** Database file name (e.g. 'nayan.db') */
  name: string;
  /** SQLCipher encryption passphrase */
  encryptionKey: string;
}

let _db: DB | null = null;

export interface DatabasePragmaState {
  journalMode: string;
  synchronous: number;
  walAutocheckpoint: number;
  cacheSizeKiB: number;
  foreignKeys: boolean;
}

export function isSQLCipherEnabled(): boolean {
  return isSQLCipher();
}

function getFirstRow(rows: unknown): any | undefined {
  if (Array.isArray(rows)) {
    return rows[0];
  }

  if (
    rows &&
    typeof rows === 'object' &&
    '_array' in rows &&
    Array.isArray(rows._array)
  ) {
    return rows._array[0];
  }

  if (
    rows &&
    typeof rows === 'object' &&
    'item' in rows &&
    typeof rows.item === 'function'
  ) {
    return rows.item(0);
  }

  return undefined;
}

export function configurePhase0Pragmas(db: DB): DatabasePragmaState {
  // SQLCipher receives the key during open(); these PRAGMAs must be the next
  // statements before migrations or application reads/writes.
  const journalModeResult = db.execute('PRAGMA journal_mode=WAL;');
  db.execute('PRAGMA synchronous=NORMAL;');
  const walAutocheckpointResult = db.execute('PRAGMA wal_autocheckpoint=100;');
  db.execute('PRAGMA cache_size=-8000;');
  db.execute('PRAGMA foreign_keys=ON;');

  const synchronousResult = db.execute('PRAGMA synchronous;');
  const cacheSizeResult = db.execute('PRAGMA cache_size;');
  const foreignKeysResult = db.execute('PRAGMA foreign_keys;');

  const journalModeRow = getFirstRow(journalModeResult.rows);
  const walAutocheckpointRow = getFirstRow(walAutocheckpointResult.rows);
  const synchronousRow = getFirstRow(synchronousResult.rows);
  const cacheSizeRow = getFirstRow(cacheSizeResult.rows);
  const foreignKeysRow = getFirstRow(foreignKeysResult.rows);

  return {
    journalMode: String(
      journalModeRow?.journal_mode ?? journalModeRow?.[0] ?? 'unknown',
    ).toLowerCase(),
    synchronous: Number(
      synchronousRow?.synchronous ?? synchronousRow?.[0] ?? 0,
    ),
    walAutocheckpoint: Number(
      walAutocheckpointRow?.wal_autocheckpoint ??
        walAutocheckpointRow?.[0] ??
        0,
    ),
    cacheSizeKiB: Number(cacheSizeRow?.cache_size ?? cacheSizeRow?.[0] ?? 0),
    foreignKeys: Number(foreignKeysRow?.foreign_keys ?? foreignKeysRow?.[0]) === 1,
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
      `synchronous=${pragmaState.synchronous}, ` +
      `wal_autocheckpoint=${pragmaState.walAutocheckpoint}, ` +
      `cache_size=${pragmaState.cacheSizeKiB}, ` +
      `foreign_keys=${String(pragmaState.foreignKeys)})`,
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
