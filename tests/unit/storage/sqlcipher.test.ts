const mockMmkvStore = new Map<string, string>();
const mockNativeModule = {
  generateSecureRandomBase64: jest.fn(async () => 'bmF5YW4tbm9uY2U='),
  deriveDatabasePassphrase: jest.fn(async () => ({
    passphrase: 'encrypted-passphrase-envelope',
    keyAlias: 'offline_face_auth_db_v1',
    provider: 'android_keystore_tee',
    envelopeVersion: 1,
  })),
};

jest.mock('react-native', () => ({
  NativeModules: {
    NativeBridge: mockNativeModule,
    SecureEnclaveManager: undefined,
  },
  Platform: {
    OS: 'android',
  },
}));

jest.mock('react-native-mmkv', () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    getString: (key: string) => mockMmkvStore.get(key),
    set: (key: string, value: string) => {
      mockMmkvStore.set(key, value);
    },
    delete: (key: string) => {
      mockMmkvStore.delete(key);
    },
  })),
}));

jest.mock('@op-engineering/op-sqlite', () => ({
  isSQLCipher: jest.fn(() => true),
  open: jest.fn(),
}));

import {open} from '@op-engineering/op-sqlite';

import {
  configureDatabasePragmas,
  closeDatabase,
  openDatabaseWithState,
} from '../../../src/storage/database/DatabaseManager';
import {runMigrations} from '../../../src/storage/database/migrations/MigrationRunner';
import {
  clearCachedSQLCipherPassphraseForTests,
  deriveSQLCipherPassphrase,
} from '../../../src/storage/encryption/KeyDerivation';

type QueryResult = {
  rowsAffected: number;
  rows: Array<Record<string, unknown>>;
};

function result(rows: Array<Record<string, unknown>> = []): QueryResult {
  return {
    rowsAffected: 0,
    rows,
  };
}

function createFakeDb(existingMigrations: number[] = []) {
  const statements: string[] = [];
  const db = {
    close: jest.fn(),
    executeSync: jest.fn((sql: string) => {
      const normalized = sql.trim();
      statements.push(normalized);

      if (normalized === 'PRAGMA journal_mode=WAL;') {
        return result([{journal_mode: 'wal'}]);
      }
      if (normalized === 'PRAGMA wal_autocheckpoint=100;') {
        return result([{wal_autocheckpoint: 100}]);
      }
      if (normalized === 'PRAGMA synchronous;') {
        return result([{synchronous: 1}]);
      }
      if (normalized === 'PRAGMA cache_size;') {
        return result([{cache_size: -8000}]);
      }
      if (normalized === 'PRAGMA foreign_keys;') {
        return result([{foreign_keys: 1}]);
      }
      if (normalized.startsWith('SELECT version FROM schema_migrations')) {
        return result(existingMigrations.map((version) => ({version})));
      }

      return result();
    }),
  };

  return {db, statements};
}

beforeEach(() => {
  jest.clearAllMocks();
  mockMmkvStore.clear();
  clearCachedSQLCipherPassphraseForTests();
});

afterEach(() => {
  closeDatabase();
});

describe('T3.1 SQLCipher setup', () => {
  it('runs WAL PRAGMAs in the required order', () => {
    const {db, statements} = createFakeDb();

    const pragmaState = configureDatabasePragmas(db as any);

    expect(pragmaState).toEqual({
      journalMode: 'wal',
      synchronous: 1,
      walAutocheckpoint: 100,
      cacheSizeKiB: -8000,
      foreignKeys: true,
    });
    expect(statements.slice(0, 5)).toEqual([
      'PRAGMA journal_mode=WAL;',
      'PRAGMA synchronous=NORMAL;',
      'PRAGMA wal_autocheckpoint=100;',
      'PRAGMA cache_size=-8000;',
      'PRAGMA foreign_keys=ON;',
    ]);
  });

  it('opens SQLCipher with the derived key before migrations', () => {
    const {db, statements} = createFakeDb();
    (open as jest.Mock).mockReturnValue(db);

    const openResult = openDatabaseWithState({
      name: 'face_auth.test.db',
      encryptionKey: 'derived-passphrase',
    });

    expect(open).toHaveBeenCalledWith({
      name: 'face_auth.test.db',
      location: undefined,
      encryptionKey: 'derived-passphrase',
    });
    expect(openResult.migrationResult?.latestVersion).toBe(3);
    expect(statements.slice(0, 5)).toEqual([
      'PRAGMA journal_mode=WAL;',
      'PRAGMA synchronous=NORMAL;',
      'PRAGMA wal_autocheckpoint=100;',
      'PRAGMA cache_size=-8000;',
      'PRAGMA foreign_keys=ON;',
    ]);
    expect(
      statements.findIndex((statement) =>
        statement.startsWith('CREATE TABLE IF NOT EXISTS schema_migrations'),
      ),
    ).toBeGreaterThan(4);
  });

  it('applies the initial schema migration once', () => {
    const {db, statements} = createFakeDb();

    const migrationResult = runMigrations(db as any);

    expect(migrationResult.applied).toHaveLength(3);
    expect(statements).toContain('BEGIN IMMEDIATE;');
    expect(
      statements.some((statement) =>
        statement.startsWith('CREATE TABLE IF NOT EXISTS attendance_ledger'),
      ),
    ).toBe(true);
    expect(
      statements.some((statement) =>
        statement.includes('idx_attendance_ledger_synced_chain'),
      ),
    ).toBe(true);
    expect(
      statements.some((statement) =>
        statement.startsWith('CREATE TABLE IF NOT EXISTS consent_log'),
      ),
    ).toBe(true);
    expect(
      statements.some((statement) =>
        statement.startsWith('CREATE TABLE IF NOT EXISTS boot_session_anchors'),
      ),
    ).toBe(true);
    expect(statements).toContain('COMMIT;');
  });

  it('caches the hardware-derived passphrase envelope', async () => {
    const first = await deriveSQLCipherPassphrase();
    const second = await deriveSQLCipherPassphrase();

    expect(first).toMatchObject({
      passphrase: 'encrypted-passphrase-envelope',
      keyAlias: 'offline_face_auth_db_v1',
      provider: 'android_keystore_tee',
      restoredFromCache: false,
    });
    expect(second).toMatchObject({
      passphrase: 'encrypted-passphrase-envelope',
      restoredFromCache: true,
    });
    expect(mockNativeModule.generateSecureRandomBase64).toHaveBeenCalledTimes(1);
    expect(mockNativeModule.deriveDatabasePassphrase).toHaveBeenCalledTimes(1);
  });
});
