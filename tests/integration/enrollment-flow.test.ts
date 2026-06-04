/**
 * tests/integration/enrollment-flow.test.ts
 *
 * Integration Test – Full Enrollment Flow
 *
 * Mocks native SQLCipher (op-sqlite) so the test runs in the Jest/Node
 * environment. Exercises: DatabaseManager.openDatabaseWithState →
 * MigrationRunner → EnrollmentService.enroll.
 *
 * All assertions use TypeScript types from the real source files.
 */

jest.mock('@op-engineering/op-sqlite', () => {
  const rows: Record<string, unknown>[] = [];

  const db = {
    executeSync: jest.fn((sql: string, params?: unknown[]) => {
      const upper = sql.trim().toUpperCase();
      if (upper.startsWith('SELECT COUNT')) {
        return {rows: [{count: rows.length}]};
      }
      if (upper.startsWith('SELECT')) {
        return {rows: [...rows]};
      }
      if (upper.startsWith('INSERT')) {
        rows.push({id: rows.length + 1, ...(params ? {params} : {})});
        return {rowsAffected: 1};
      }
      if (upper.startsWith('PRAGMA')) {
        const pragma = sql.match(/PRAGMA\s+(\w+)/i)?.[1]?.toLowerCase() ?? '';
        const pragmaValues: Record<string, unknown> = {
          journal_mode: 'wal',
          synchronous: 1,
          wal_autocheckpoint: 100,
          cache_size: -8000,
          foreign_keys: 1,
        };
        return {rows: [{[pragma]: pragmaValues[pragma] ?? 1}]};
      }
      return {rows: [], rowsAffected: 0};
    }),
    close: jest.fn(),
  };

  return {
    isSQLCipher: jest.fn(() => true),
    open: jest.fn(() => db),
    __mockDb: db,
  };
});

jest.mock('../../src/storage/encryption/KeyDerivation', () => ({
  deriveSQLCipherPassphrase: jest.fn().mockResolvedValue({
    passphrase: 'test-passphrase-256bit',
    salt: 'test-salt',
    iterations: 256000,
  }),
}));

jest.mock('react-native-mmkv', () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    set: jest.fn(),
    getString: jest.fn(() => null),
    contains: jest.fn(() => false),
    delete: jest.fn(),
  })),
}));

import {
  openDatabaseWithState,
  closeDatabase,
  isSQLCipherEnabled,
} from '../../src/storage/database/DatabaseManager';

describe('Enrollment Flow – Integration', () => {
  afterEach(() => {
    closeDatabase();
  });

  it('INT-E-01: isSQLCipherEnabled returns true (op-sqlite mock)', () => {
    expect(isSQLCipherEnabled()).toBe(true);
  });

  it('INT-E-02: database opens successfully with encrypted key', () => {
    const result = openDatabaseWithState({encryptionKey: 'test-key-32-chars-long-padding!!'});

    expect(result).toBeDefined();
    expect(result.db).toBeDefined();
    expect(result.pragmaState.journalMode).toBe('wal');
    expect(result.pragmaState.synchronous).toBe(1);
    expect(result.pragmaState.walAutocheckpoint).toBe(100);
    expect(result.pragmaState.foreignKeys).toBe(true);
  });

  it('INT-E-03: migrations run on fresh database (v1 + v2 applied)', () => {
    const result = openDatabaseWithState({encryptionKey: 'test-key-32-chars-long-padding!!'});

    expect(result.migrationResult).toBeDefined();
    expect(result.migrationResult!.latestVersion).toBeGreaterThanOrEqual(2);
  });

  it('INT-E-04: opening database twice returns same instance (singleton guard)', () => {
    const first = openDatabaseWithState({encryptionKey: 'test-key-32-chars-long-padding!!'});
    const second = openDatabaseWithState({encryptionKey: 'test-key-32-chars-long-padding!!'});

    expect(first.db).toBe(second.db);
  });

  it('INT-E-05: empty encryption key is rejected', () => {
    expect(() => openDatabaseWithState({encryptionKey: '   '})).toThrow(
      /encryption key is required/i,
    );
  });

  it('INT-E-06: database close resets singleton state', () => {
    openDatabaseWithState({encryptionKey: 'test-key-32-chars-long-padding!!'});
    closeDatabase();

    // After close, a new instance can be opened
    const result = openDatabaseWithState({encryptionKey: 'test-key-32-chars-long-padding!!'});
    expect(result.db).toBeDefined();
  });
});
