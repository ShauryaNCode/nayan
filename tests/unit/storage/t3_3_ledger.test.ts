const mockMmkvStores = new Map<string, Map<string, unknown>>();
const mockPersonnelRows = new Map<string, {kek_hw_wrapped: string}>();
const mockLedgerRows: Array<Record<string, unknown>> = [];
const mockAnchorRows: Array<Record<string, unknown>> = [];

let mockUptimeMs = 1000;

const MOCK_DEK_HEX = '11'.repeat(32);

const mockNativeModules = {
  NativeUptimeClock: {
    getUptimeMs: jest.fn(async () => {
      mockUptimeMs += 2000;
      return mockUptimeMs;
    }),
  },
  NativeBridge: {
    generatePersonKey: jest.fn(async () => undefined),
    wrapDEK: jest.fn(async (_personnelId: string, dekHex: string) => dekHex),
    unwrapDEK: jest.fn(async (_personnelId: string, wrappedDEK: string) => wrappedDEK),
  },
  SecureEnclaveManager: undefined,
  EmbeddingCrypto: undefined,
};

function mockGetStore(id: string): Map<string, unknown> {
  let store = mockMmkvStores.get(id);
  if (!store) {
    store = new Map<string, unknown>();
    mockMmkvStores.set(id, store);
  }
  return store;
}

jest.mock('react-native', () => ({
  NativeModules: mockNativeModules,
  TurboModuleRegistry: {
    get: jest.fn((name: string) => mockNativeModules[name as keyof typeof mockNativeModules] ?? null),
  },
  Platform: {
    OS: 'android',
  },
}));

jest.mock('react-native-mmkv', () => ({
  MMKV: jest.fn().mockImplementation(({id}: {id: string}) => {
    const store = mockGetStore(id);
    return {
      getNumber: (key: string) => {
        const value = store.get(key);
        return typeof value === 'number' ? value : undefined;
      },
      getString: (key: string) => {
        const value = store.get(key);
        return typeof value === 'string' ? value : undefined;
      },
      set: (key: string, value: unknown) => {
        store.set(key, value);
      },
      delete: (key: string) => {
        store.delete(key);
      },
    };
  }),
}));

jest.mock('../../../src/crypto/EmbeddingCrypto', () => ({
  EmbeddingCrypto: {
    encrypt: jest.fn(async (plaintextBase64: string, personnelId: string) =>
      `ledger:${personnelId}:${plaintextBase64}`,
    ),
    decrypt: jest.fn(async (encryptedBlob: string, personnelId: string) => {
      const prefix = `ledger:${personnelId}:`;
      if (!encryptedBlob.startsWith(prefix)) {
        throw new Error('bad ledger payload');
      }
      return encryptedBlob.slice(prefix.length);
    }),
  },
}));

function result(rows: Array<Record<string, unknown>> = []) {
  return {rows, rowsAffected: rows.length};
}

function firstLedgerRowByCounter(counter: number): Record<string, unknown> | undefined {
  return mockLedgerRows.find((row) => Number(row.event_counter) === counter);
}

const mockDb = {
  executeSync: jest.fn((sql: string, params: unknown[] = []) => {
    const normalized = sql.replace(/\s+/g, ' ').trim();

    if (
      normalized === 'BEGIN IMMEDIATE;' ||
      normalized === 'COMMIT;' ||
      normalized === 'ROLLBACK;'
    ) {
      return result();
    }

    if (normalized.startsWith('SELECT kek_hw_wrapped FROM personnel')) {
      const personnelId = params[0] as string;
      const row = mockPersonnelRows.get(personnelId);
      return result(row ? [{kek_hw_wrapped: row.kek_hw_wrapped}] : []);
    }

    if (normalized.startsWith('SELECT current_hash FROM attendance_ledger')) {
      const latest = [...mockLedgerRows].sort(
        (a, b) => Number(b.event_counter) - Number(a.event_counter),
      )[0];
      return result(latest ? [{current_hash: latest.current_hash}] : []);
    }

    if (normalized.startsWith('INSERT INTO attendance_ledger')) {
      mockLedgerRows.push({
        ledger_id: params[0],
        id: params[1],
        personnel_id: params[2],
        event_type: params[3],
        captured_at: params[4],
        device_id: params[5],
        confidence: params[6],
        payload_json: params[7],
        encrypted_payload: params[8],
        previous_hash: params[9],
        prev_hash: params[10],
        current_hash: params[11],
        chain_index: params[12],
        ts: params[13],
        uptime_ms: params[14],
        event_counter: params[15],
        synced: 0,
        consent_withdrawn: 0,
        created_at: params[16],
      });
      return result();
    }

    if (normalized.startsWith('INSERT INTO boot_session_anchors')) {
      mockAnchorRows.push({
        wall_ts: params[0],
        uptime_ms: params[1],
        event_id: params[2],
        session_hash: params[3],
      });
      return result();
    }

    if (normalized.startsWith('SELECT ledger_id AS id')) {
      return result(
        [...mockLedgerRows]
          .sort((a, b) => Number(a.event_counter) - Number(b.event_counter))
          .map((row) => ({
            id: row.ledger_id,
            personnel_id: row.personnel_id,
            encrypted_payload: row.encrypted_payload,
            prev_hash: row.prev_hash ?? row.previous_hash,
            current_hash: row.current_hash,
            ts: row.ts,
            uptime_ms: row.uptime_ms,
            event_counter: row.event_counter,
          })),
      );
    }

    if (normalized.startsWith('UPDATE attendance_ledger SET ts = ts - 999999')) {
      const inlineCounter = normalized.match(/event_counter = (\d+)/)?.[1];
      const counter = Number(params[0] ?? inlineCounter);
      const row = firstLedgerRowByCounter(counter);
      if (row) {
        row.ts = Number(row.ts) - 999999;
      }
      return result();
    }

    if (normalized.startsWith('SELECT prev_hash FROM attendance_ledger')) {
      const row = firstLedgerRowByCounter(params[0] as number);
      return result(row ? [{prev_hash: row.prev_hash}] : []);
    }

    if (normalized.startsWith('SELECT uptime_ms FROM attendance_ledger')) {
      return result(
        [...mockLedgerRows]
          .sort((a, b) => Number(a.event_counter) - Number(b.event_counter))
          .map((row) => ({uptime_ms: row.uptime_ms})),
      );
    }

    if (normalized.startsWith('SELECT wall_ts, uptime_ms, event_id, session_hash')) {
      return result([...mockAnchorRows]);
    }

    throw new Error(`Unexpected SQL in T3.3 test: ${normalized}`);
  }),
};

jest.mock('../../../src/storage/database/DatabaseManager', () => ({
  getDatabase: () => mockDb,
}));

const {SHA256} = require('../../../src/crypto/SHA256');
const {CanonicalJSON} = require('../../../src/utils/CanonicalJSON');
const {EventCounter} = require('../../../src/storage/EventCounter');
const {LedgerService} = require('../../../src/storage/LedgerService');

async function recordEvents(count: number): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await LedgerService.recordEvent({
      personnelId: 'person-1',
      eventType: 'VERIFICATION',
      matchScore: 0.91,
      deviceId: 'device-test',
    });
  }
}

beforeEach(() => {
  jest.clearAllMocks();
  for (const store of mockMmkvStores.values()) {
    store.clear();
  }
  mockPersonnelRows.clear();
  mockLedgerRows.length = 0;
  mockAnchorRows.length = 0;
  mockUptimeMs = 1000;
  mockPersonnelRows.set('person-1', {kek_hw_wrapped: MOCK_DEK_HEX});
  EventCounter.resetForTests();
});

describe('T3.3 deterministic primitives', () => {
  it('computes the standard SHA-256 abc test vector', () => {
    expect(SHA256.digest('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('serializes canonical JSON recursively with sorted keys', () => {
    expect(
      CanonicalJSON.stringify({z: 1, a: 2, m: {y: 9, b: 3}}),
    ).toBe('{"a":2,"m":{"b":3,"y":9},"z":1}');
  });

  it('persists an MMKV-backed monotonic event counter across module reloads', () => {
    const values = Array.from({length: 100}, () => EventCounter.getNext());
    expect(values).toEqual(Array.from({length: 100}, (_, index) => index + 1));

    jest.isolateModules(() => {
      const {EventCounter: RestartedEventCounter} = require('../../../src/storage/EventCounter');
      expect(RestartedEventCounter.getNext()).toBe(101);
    });
  });
});

describe('T3.3 ledger chain', () => {
  it('verifies a clean 10-record chain', async () => {
    await recordEvents(10);

    await expect(LedgerService.verifyChain()).resolves.toEqual({
      ok: true,
      totalRecords: 10,
    });
  });

  it('verifies a 100-record chain in under 50ms', async () => {
    await recordEvents(100);

    const start = performance.now();
    const chain = await LedgerService.verifyChain();
    const elapsedMs = performance.now() - start;

    expect(chain).toEqual({ok: true, totalRecords: 100});
    expect(elapsedMs).toBeLessThan(50);
  });

  it('detects tampering at the third record', async () => {
    await recordEvents(10);

    mockDb.executeSync(
      'UPDATE attendance_ledger SET ts = ts - 999999 WHERE event_counter = 3',
    );

    const chain = await LedgerService.verifyChain();
    expect(chain.ok).toBe(false);
    expect(chain.brokenAt?.index).toBe(2);
    expect(chain.brokenAt?.event_counter).toBe(3);
  });

  it('binds monotonic uptime across events in the same boot session', async () => {
    await recordEvents(2);

    const rows = mockDb.executeSync(
      'SELECT uptime_ms FROM attendance_ledger ORDER BY event_counter ASC;',
    ).rows;

    expect(Number(rows[1].uptime_ms)).toBeGreaterThan(Number(rows[0].uptime_ms));
  });

  it('uses the zero hash as the genesis previous hash', async () => {
    await recordEvents(1);

    const row = mockDb.executeSync(
      'SELECT prev_hash FROM attendance_ledger WHERE event_counter = ?;',
      [1],
    ).rows[0];

    expect(row.prev_hash).toBe('0'.repeat(64));
  });

  it('writes one boot session anchor per ledger event with a verifiable session hash', async () => {
    await recordEvents(3);

    const rows = mockDb.executeSync(
      'SELECT wall_ts, uptime_ms, event_id, session_hash FROM boot_session_anchors;',
    ).rows;

    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.session_hash).toBe(
        SHA256.digest(`${row.wall_ts}|${row.uptime_ms}|${row.event_id}`),
      );
    }
  });
});
