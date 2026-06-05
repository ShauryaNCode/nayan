import {webcrypto} from 'crypto';

Object.defineProperty(globalThis, 'crypto', {
  value: webcrypto,
  configurable: true,
});

const mockMmkvStore = new Map<string, unknown>();
const mockDekHex = '44'.repeat(32);
let mockUptimeMs = 5000;

type MockPersonnelRow = {
  personnel_id: string;
  kek_hw_wrapped: string;
  enrollment_status: string;
};

type MockLedgerRow = {
  ledger_id: string;
  id: string;
  personnel_id: string;
  event_type: string;
  captured_at: string;
  device_id: string;
  confidence: number | null;
  payload_json: string;
  payload_hash: string;
  encrypted_payload: string | null;
  previous_hash: string;
  prev_hash: string;
  current_hash: string;
  chain_index: number;
  ts: number;
  uptime_ms: number;
  event_counter: number;
  synced: number;
  consent_withdrawn: number;
  created_at: string;
};

function mockResult(rows: Array<Record<string, unknown>> = []) {
  return {rows, rowsAffected: rows.length};
}

class MockSqlCipherDb {
  readonly schemaMigrations = new Set<number>();
  readonly personnelRows = new Map<string, MockPersonnelRow>();
  readonly ledgerRows: MockLedgerRow[] = [];
  readonly anchorRows: Array<Record<string, unknown>> = [];

  readonly close = jest.fn();

  readonly executeSync = jest.fn((sql: string, params: unknown[] = []) =>
    this.execute(sql, params),
  );

  reset(): void {
    this.schemaMigrations.clear();
    this.personnelRows.clear();
    this.ledgerRows.length = 0;
    this.anchorRows.length = 0;
    this.close.mockClear();
    this.executeSync.mockClear();
  }

  seedPersonnel(personnelId: string, wrappedDek = mockDekHex): void {
    this.personnelRows.set(personnelId, {
      personnel_id: personnelId,
      kek_hw_wrapped: wrappedDek,
      enrollment_status: 'active',
    });
  }

  private execute(sql: string, params: unknown[]) {
    const normalized = sql.replace(/\s+/g, ' ').trim();

    if (
      normalized === 'BEGIN IMMEDIATE;' ||
      normalized === 'COMMIT;' ||
      normalized === 'ROLLBACK;' ||
      normalized === 'PRAGMA defer_foreign_keys=ON;'
    ) {
      return mockResult();
    }

    if (normalized === 'PRAGMA journal_mode=WAL;') {
      return mockResult([{journal_mode: 'wal'}]);
    }
    if (normalized === 'PRAGMA synchronous=NORMAL;') {
      return mockResult();
    }
    if (normalized === 'PRAGMA wal_autocheckpoint=0;') {
      return mockResult([{wal_autocheckpoint: 0}]);
    }
    if (normalized === 'PRAGMA cache_size=-8000;') {
      return mockResult();
    }
    if (normalized === 'PRAGMA foreign_keys=ON;') {
      return mockResult();
    }
    if (normalized === 'PRAGMA synchronous;') {
      return mockResult([{synchronous: 1}]);
    }
    if (normalized === 'PRAGMA cache_size;') {
      return mockResult([{cache_size: -8000}]);
    }
    if (normalized === 'PRAGMA foreign_keys;') {
      return mockResult([{foreign_keys: 1}]);
    }
    if (normalized === 'PRAGMA wal_checkpoint(PASSIVE);') {
      return mockResult([{busy: 0, log: 0, checkpointed: 0}]);
    }

    if (
      normalized.startsWith('CREATE ') ||
      normalized.startsWith('ALTER TABLE ') ||
      normalized.startsWith('DROP TABLE ') ||
      normalized.startsWith('CREATE INDEX ')
    ) {
      return mockResult();
    }

    if (normalized.startsWith('SELECT version FROM schema_migrations')) {
      return mockResult(
        Array.from(this.schemaMigrations).map((version) => ({version})),
      );
    }

    if (normalized.startsWith('INSERT INTO schema_migrations')) {
      this.schemaMigrations.add(params[0] as number);
      return mockResult();
    }

    if (normalized.startsWith('INSERT INTO attendance_ledger_t36')) {
      return mockResult();
    }

    if (normalized.startsWith('INSERT INTO attendance_ledger (')) {
      this.ledgerRows.push({
        ledger_id: params[0] as string,
        id: params[1] as string,
        personnel_id: params[2] as string,
        event_type: params[3] as string,
        captured_at: params[4] as string,
        device_id: params[5] as string,
        confidence: params[6] as number | null,
        payload_json: params[7] as string,
        payload_hash: params[8] as string,
        encrypted_payload: params[9] as string | null,
        previous_hash: params[10] as string,
        prev_hash: params[11] as string,
        current_hash: params[12] as string,
        chain_index: params[13] as number,
        ts: params[14] as number,
        uptime_ms: params[15] as number,
        event_counter: params[16] as number,
        synced: 0,
        consent_withdrawn: 0,
        created_at: params[17] as string,
      });
      return mockResult();
    }

    if (normalized.startsWith('INSERT INTO boot_session_anchors')) {
      this.anchorRows.push({
        wall_ts: params[0],
        uptime_ms: params[1],
        event_id: params[2],
        session_hash: params[3],
      });
      return mockResult();
    }

    if (normalized.startsWith('SELECT kek_hw_wrapped FROM personnel')) {
      const row = this.personnelRows.get(params[0] as string);
      return mockResult(row ? [{kek_hw_wrapped: row.kek_hw_wrapped}] : []);
    }

    if (normalized.startsWith('SELECT current_hash FROM attendance_ledger')) {
      const latest = [...this.ledgerRows].sort(
        (a, b) => Number(b.event_counter) - Number(a.event_counter),
      )[0];
      return mockResult(latest ? [{current_hash: latest.current_hash}] : []);
    }

    if (normalized.startsWith('SELECT ledger_id AS id')) {
      return mockResult(
        [...this.ledgerRows]
          .sort((a, b) => Number(a.event_counter) - Number(b.event_counter))
          .map((row) => ({
            id: row.ledger_id,
            personnel_id: row.personnel_id,
            payload_json: row.payload_json,
            encrypted_payload: row.encrypted_payload,
            payload_hash: row.payload_hash,
            prev_hash: row.prev_hash ?? row.previous_hash,
            current_hash: row.current_hash,
            ts: row.ts,
            uptime_ms: row.uptime_ms,
            event_counter: row.event_counter,
            consent_withdrawn: row.consent_withdrawn,
            event_type: row.event_type,
          })),
      );
    }

    if (
      normalized.startsWith(
        'UPDATE attendance_ledger SET encrypted_payload = ? WHERE event_counter = ?',
      )
    ) {
      const row = this.ledgerRows.find(
        (entry) => Number(entry.event_counter) === Number(params[1]),
      );
      if (row) {
        row.encrypted_payload = params[0] as string;
      }
      return mockResult();
    }

    throw new Error(`Unexpected SQL in ledger integration test: ${normalized}`);
  }
}

const mockSqlCipherDb = new MockSqlCipherDb();

jest.mock('@op-engineering/op-sqlite', () => ({
  isSQLCipher: jest.fn(() => true),
  open: jest.fn(() => mockSqlCipherDb),
}));

jest.mock('react-native', () => ({
  ...(() => {
    const nativeModules = {
      NativeUptimeClock: {
        getUptimeMs: jest.fn(async () => {
          mockUptimeMs += 100;
          return mockUptimeMs;
        }),
      },
      NativeBridge: {
        generatePersonKey: jest.fn(async () => undefined),
        wrapDEK: jest.fn(
          async (_personnelId: string, dekHex: string) => dekHex,
        ),
        unwrapDEK: jest.fn(
          async (_personnelId: string, wrappedDEKBase64: string) =>
            wrappedDEKBase64,
        ),
      },
      EmbeddingCrypto: undefined,
      SecureEnclaveManager: undefined,
    };

    return {
      NativeModules: nativeModules,
      TurboModuleRegistry: {
        get: jest.fn(
          (name: string) =>
            nativeModules[name as keyof typeof nativeModules] ?? null,
        ),
      },
      Platform: {
        OS: 'android',
      },
    };
  })(),
}));

jest.mock('react-native-mmkv', () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    getNumber: (key: string) => {
      const value = mockMmkvStore.get(key);
      return typeof value === 'number' ? value : undefined;
    },
    set: (key: string, value: unknown) => {
      mockMmkvStore.set(key, value);
    },
    delete: (key: string) => {
      mockMmkvStore.delete(key);
    },
  })),
}));

import {
  closeDatabase,
  openDatabaseWithState,
} from '../storage/database/DatabaseManager';
import {EventCounter} from '../storage/EventCounter';
import {insertLedgerEvent, LedgerService} from '../storage/LedgerService';

describe('verifyChain SQLCipher integration', () => {
  beforeEach(() => {
    closeDatabase();
    jest.clearAllMocks();
    mockSqlCipherDb.reset();
    mockMmkvStore.clear();
    mockUptimeMs = 5000;
    EventCounter.resetForTests();
  });

  afterEach(() => {
    closeDatabase();
  });

  it('detects a raw SQL encrypted payload mutation after real ledger inserts', async () => {
    const openResult = openDatabaseWithState({
      name: 'ledger-integration-memory',
      location: ':memory:',
      encryptionKey: 'test-sqlcipher-passphrase',
    });
    expect(openResult.migrationResult?.latestVersion).toBe(5);

    mockSqlCipherDb.seedPersonnel('person-ledger', mockDekHex);

    for (let i = 0; i < 10; i += 1) {
      await insertLedgerEvent({
        personnelId: 'person-ledger',
        eventType: 'VERIFICATION',
        matchScore: 0.81 + i / 1000,
        deviceId: 'device-sqlcipher-test',
      });
    }

    await expect(LedgerService.verifyChain()).resolves.toEqual({
      ok: true,
      totalRecords: 10,
    });

    mockSqlCipherDb.executeSync(
      'UPDATE attendance_ledger SET encrypted_payload = ? WHERE event_counter = ?;',
      ['tampered-payload', 6],
    );

    const tampered = await LedgerService.verifyChain();
    expect(tampered.ok).toBe(false);
    expect(tampered.brokenAt?.index).toBe(5);
    expect(tampered.brokenAt?.event_counter).toBe(6);
  });
});
