const mockLedgerRows: LedgerFixtureRow[] = [];

const mockDb = {
  executeSync: jest.fn((sql: string) => {
    const normalized = sql.replace(/\s+/g, ' ').trim();

    if (normalized.startsWith('SELECT ledger_id AS id')) {
      return {
        rows: [...mockLedgerRows].sort(
          (a, b) => Number(a.event_counter) - Number(b.event_counter),
        ),
        rowsAffected: 0,
      };
    }

    throw new Error(`Unexpected SQL in ledger unit test: ${normalized}`);
  }),
};

jest.mock('react-native', () => ({
  NativeModules: {},
  TurboModuleRegistry: {
    get: jest.fn(() => null),
  },
  Platform: {
    OS: 'android',
  },
}));

jest.mock('react-native-mmkv', () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    getNumber: jest.fn(() => undefined),
    set: jest.fn(),
    delete: jest.fn(),
  })),
}));

jest.mock('../storage/database/DatabaseManager', () => ({
  getDatabase: () => mockDb,
}));

import {SHA256} from '../crypto/SHA256';
import {LedgerService, type VerifyChainResult} from '../storage/LedgerService';
import {CanonicalJSON} from '../utils/canonicalJSON';

type LedgerFixtureRow = {
  id: string;
  ledger_id: string;
  personnel_id?: string;
  payload_json: string;
  encrypted_payload?: string | null;
  payload_hash: string;
  prev_hash: string;
  previous_hash: string;
  current_hash: string;
  ts: number;
  uptime_ms: number;
  event_counter: number;
  consent_withdrawn: number;
  event_type: string;
};

const GENESIS_HASH = '0'.repeat(64);

function toRequestedResult(result: VerifyChainResult): {
  valid: boolean;
  firstCorruptIndex: number | null;
} {
  return {
    valid: result.ok,
    firstCorruptIndex: result.brokenAt?.index ?? null,
  };
}

function payloadFor(params: {
  eventCounter: number;
  ts: number;
  index: number;
}): Record<string, unknown> {
  return {
    device_id: 'device-ledger-test',
    event_counter: params.eventCounter,
    event_type: 'VERIFICATION',
    location_tag: null,
    match_score: 0.9 + params.index / 1000,
    personnel_id: `person-${params.eventCounter}`,
    ts: params.ts,
  };
}

function buildLedger(eventCounters: number[]): LedgerFixtureRow[] {
  let prevHash = GENESIS_HASH;

  return eventCounters.map((eventCounter, index) => {
    const ts = 1_700_000_000_000 + index * 1000;
    const uptimeMs = 10_000 + index * 50;
    const payloadJson = CanonicalJSON.stringify(
      payloadFor({eventCounter, ts, index}),
    );
    const payloadHash = SHA256.digest(payloadJson);
    const currentHash = SHA256.digest(
      [
        prevHash,
        payloadHash,
        String(ts),
        String(uptimeMs),
        String(eventCounter),
      ].join('|'),
    );
    const row = {
      id: `ledger-${eventCounter}`,
      ledger_id: `ledger-${eventCounter}`,
      payload_json: payloadJson,
      encrypted_payload: null,
      payload_hash: payloadHash,
      prev_hash: prevHash,
      previous_hash: prevHash,
      current_hash: currentHash,
      ts,
      uptime_ms: uptimeMs,
      event_counter: eventCounter,
      consent_withdrawn: 0,
      event_type: 'verification',
    };

    prevHash = currentHash;
    return row;
  });
}

async function expectChain(): Promise<{
  valid: boolean;
  firstCorruptIndex: number | null;
}> {
  return toRequestedResult(await LedgerService.verifyChain());
}

beforeEach(() => {
  jest.clearAllMocks();
  mockLedgerRows.length = 0;
});

describe('verifyChain tamper detection', () => {
  it('clean chain', async () => {
    mockLedgerRows.push(...buildLedger([1, 2, 3, 4, 5]));

    await expect(expectChain()).resolves.toEqual({
      valid: true,
      firstCorruptIndex: null,
    });
  });

  it('payload tampered', async () => {
    mockLedgerRows.push(...buildLedger([1, 2, 3, 4, 5]));
    const originalPayload = JSON.parse(mockLedgerRows[2].payload_json);
    mockLedgerRows[2].payload_json = CanonicalJSON.stringify({
      ...originalPayload,
      match_score: 0.123,
    });

    await expect(expectChain()).resolves.toEqual({
      valid: false,
      firstCorruptIndex: 2,
    });
  });

  it('ts rolled back', async () => {
    mockLedgerRows.push(...buildLedger([1, 2, 3, 4, 5]));
    mockLedgerRows[3].ts = mockLedgerRows[2].ts - 1;

    await expect(expectChain()).resolves.toEqual({
      valid: false,
      firstCorruptIndex: 3,
    });
  });

  it('uptime_ms tampered', async () => {
    mockLedgerRows.push(...buildLedger([1, 2, 3, 4, 5]));
    mockLedgerRows[1].uptime_ms += 1;

    await expect(expectChain()).resolves.toEqual({
      valid: false,
      firstCorruptIndex: 1,
    });
  });

  it('event_counter gap', async () => {
    mockLedgerRows.push(...buildLedger([1, 2, 3, 5]));

    await expect(expectChain()).resolves.toEqual({
      valid: false,
      firstCorruptIndex: 3,
    });
  });

  it('middle record deleted', async () => {
    const ledger = buildLedger([1, 2, 3, 4, 5]);
    ledger.splice(2, 1);
    mockLedgerRows.push(...ledger);

    await expect(expectChain()).resolves.toEqual({
      valid: false,
      firstCorruptIndex: 2,
    });
  });

  it('single record chain', async () => {
    mockLedgerRows.push(...buildLedger([1]));

    await expect(expectChain()).resolves.toEqual({
      valid: true,
      firstCorruptIndex: null,
    });
  });
});
