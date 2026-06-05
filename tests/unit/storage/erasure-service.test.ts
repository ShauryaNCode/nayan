import type {ErasureRequest} from '../../../src/storage/ErasureService';

const mockMmkvStores = new Map<string, Map<string, unknown>>();
const mockPersonKeys = new Set<string>();
const mockWrappedDeks = new Map<string, string>();
const mockDestroyFailures = new Set<string>();
const mockNetInfo = {
  fetch: jest.fn(async () => ({isConnected: true})),
};
const mockBuildAndSignReceipt = jest.fn(
  async (personnelId: string, commandNonce: string) => ({
    personnel_id: personnelId,
    device_id: 'device-public-key-base64',
    purge_ts: 1700000000000,
    uptime_ms: 12345,
    command_nonce: commandNonce,
    signature: `signature:${personnelId}:${commandNonce}`,
  }),
);
const mockUploadDeletionReceipt = jest.fn(async () => ({success: true}));
let mockUptimeMs = 1000;

function mockGetStore(id?: string): Map<string, unknown> {
  const storeId = id ?? 'default';
  let store = mockMmkvStores.get(storeId);
  if (!store) {
    store = new Map<string, unknown>();
    mockMmkvStores.set(storeId, store);
  }
  return store;
}

jest.mock('react-native-mmkv', () => ({
  MMKV: jest.fn().mockImplementation(({id}: {id?: string} = {}) => {
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
      getAllKeys: () => Array.from(store.keys()),
    };
  }),
}));

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: mockNetInfo,
}));

jest.mock('../../../src/services/deviceKey', () => ({
  buildAndSignReceipt: (personnelId: string, commandNonce: string) =>
    mockBuildAndSignReceipt(personnelId, commandNonce),
  getDevicePublicKey: jest.fn(async () => 'device-public-key-base64'),
}));

jest.mock('../../../src/services/uploadDeletionReceipt', () => ({
  uploadDeletionReceipt: (receipt: unknown) => mockUploadDeletionReceipt(receipt),
}));

jest.mock('../../../src/crypto/NativeSecureKey', () => ({
  NativeSecureKey: {
    generateSecureRandomBase64: jest.fn(async (byteLength: number) =>
      Buffer.alloc(byteLength, 7).toString('base64'),
    ),
    generatePersonKey: jest.fn(async (personnelId: string) => {
      if (mockPersonKeys.has(personnelId)) {
        throw new Error('KEY_EXISTS');
      }
      mockPersonKeys.add(personnelId);
    }),
    wrapDEK: jest.fn(async (personnelId: string, dekHex: string) => {
      if (!mockPersonKeys.has(personnelId)) {
        throw new Error('KEY_NOT_FOUND');
      }
      const wrapped = `wrapped:${personnelId}:${dekHex}`;
      mockWrappedDeks.set(personnelId, wrapped);
      return wrapped;
    }),
    unwrapDEK: jest.fn(async (personnelId: string, wrappedDEK: string) => {
      if (!mockPersonKeys.has(personnelId)) {
        throw new Error('KEY_NOT_FOUND');
      }
      const prefix = `wrapped:${personnelId}:`;
      if (!wrappedDEK.startsWith(prefix)) {
        throw new Error('BAD_WRAPPED_DEK');
      }
      return wrappedDEK.slice(prefix.length);
    }),
    destroyPersonKey: jest.fn(async (personnelId: string) => {
      if (mockDestroyFailures.has(personnelId)) {
        throw new Error('KEY_DESTROY_FAILED');
      }
      if (!mockPersonKeys.has(personnelId)) {
        throw new Error('KEY_NOT_FOUND');
      }
      mockPersonKeys.delete(personnelId);
    }),
    deletePersonKey: jest.fn(async (personnelId: string) => {
      mockPersonKeys.delete(personnelId);
    }),
    getNativeModuleForTests: jest.fn(() => ({
      generateSecureRandomBase64: async (byteLength: number) =>
        Buffer.alloc(byteLength, 7).toString('base64'),
    })),
  },
}));

jest.mock('../../../src/crypto/EmbeddingCrypto', () => ({
  EmbeddingCrypto: {
    encrypt: jest.fn(async (plaintextBase64: string, personnelId: string) =>
      `enc:${personnelId}:${plaintextBase64}`,
    ),
    decrypt: jest.fn(async (encryptedBlob: string, personnelId: string) => {
      const prefix = `enc:${personnelId}:`;
      if (!encryptedBlob.startsWith(prefix)) {
        throw new Error('BAD_CIPHERTEXT');
      }
      return encryptedBlob.slice(prefix.length);
    }),
  },
}));

jest.mock('../../../src/crypto/AdminKey', () => ({
  ADMIN_KEY_VERSION: 1,
  ADMIN_PUBLIC_KEY_PEM: 'test-admin-public-key',
}));

jest.mock('../../../src/crypto/RSAOAEP', () => ({
  wrapDEKWithAdminPublicKey: jest.fn(async () => 'admin-wrapped-dek'),
}));

jest.mock('../../../src/crypto/LSHModule', () => ({
  LSHModule: {
    loadHyperplanes: jest.fn(async () => undefined),
    computeBucketKeys: jest.fn(async () => ['0_1', '1_1', '2_1', '3_1']),
  },
}));

jest.mock('../../../src/native/NativeUptimeClock', () => ({
  NativeUptimeClock: {
    getUptimeMs: jest.fn(async () => {
      mockUptimeMs += 1000;
      return mockUptimeMs;
    }),
  },
}));

type PersonnelRow = {
  personnel_id: string;
  full_name: string;
  role: string;
  encrypted_embed: string;
  kek_hw_wrapped: string;
  kek_admin_wrapped: string;
  admin_key_version: number;
  enrollment_ts: number;
  consent_ts: number;
  enrollment_status: string;
};

type LshRow = {
  personnel_id: string;
  bucket_key: string;
  band_index: number;
  signature: string;
  updated_at: string;
};

type LedgerRow = Record<string, unknown> & {
  ledger_id: string;
  personnel_id: string | null;
  payload_hash?: string;
  encrypted_payload?: string | null;
  consent_withdrawn: number;
  event_counter: number;
};

const mockPersonnelRows = new Map<string, PersonnelRow>();
let mockConsentRows: Array<Record<string, unknown>> = [];
let mockLshRows: LshRow[] = [];
let mockLedgerRows: LedgerRow[] = [];
let mockAnchorRows: Array<Record<string, unknown>> = [];
let mockFailCommit = false;
let transactionSnapshot: ReturnType<typeof snapshotTables> | null = null;

function result(rows: Array<Record<string, unknown>> = []) {
  return {rows, rowsAffected: rows.length};
}

function snapshotTables() {
  return {
    personnelRows: new Map(
      Array.from(mockPersonnelRows.entries()).map(([key, value]) => [
        key,
        {...value},
      ]),
    ),
    consentRows: mockConsentRows.map((row) => ({...row})),
    lshRows: mockLshRows.map((row) => ({...row})),
    ledgerRows: mockLedgerRows.map((row) => ({...row})) as LedgerRow[],
    anchorRows: mockAnchorRows.map((row) => ({...row})),
  };
}

function restoreTables(snapshot: ReturnType<typeof snapshotTables>): void {
  mockPersonnelRows.clear();
  for (const [key, value] of snapshot.personnelRows.entries()) {
    mockPersonnelRows.set(key, value);
  }
  mockConsentRows = snapshot.consentRows.map((row) => ({...row}));
  mockLshRows = snapshot.lshRows.map((row) => ({...row}));
  mockLedgerRows = snapshot.ledgerRows.map((row) => ({...row})) as LedgerRow[];
  mockAnchorRows = snapshot.anchorRows.map((row) => ({...row}));
}

const mockDb = {
  executeSync: jest.fn((sql: string, params: unknown[] = []) => {
    const normalized = sql.replace(/\s+/g, ' ').trim();

    if (normalized === 'BEGIN TRANSACTION;' || normalized === 'BEGIN IMMEDIATE;') {
      transactionSnapshot = snapshotTables();
      return result();
    }

    if (normalized === 'COMMIT;') {
      if (mockFailCommit) {
        throw new Error('COMMIT_FAILED_FOR_TEST');
      }
      transactionSnapshot = null;
      return result();
    }

    if (normalized === 'ROLLBACK;') {
      if (transactionSnapshot) {
        restoreTables(transactionSnapshot);
        transactionSnapshot = null;
      }
      return result();
    }

    if (normalized === 'PRAGMA defer_foreign_keys=ON;') {
      return result();
    }

    if (normalized === 'PRAGMA table_info(lsh_index);') {
      return result([
        {name: 'bucket_key'},
        {name: 'personnel_id'},
        {name: 'band_index'},
        {name: 'signature'},
        {name: 'updated_at'},
      ]);
    }

    if (normalized.startsWith('SELECT personnel_id AS id, full_name AS name')) {
      const row = mockPersonnelRows.get(params[0] as string);
      return result(
        row
          ? [
              {
                id: row.personnel_id,
                name: row.full_name,
                kek_hw_wrapped: row.kek_hw_wrapped,
              },
            ]
          : [],
      );
    }

    if (normalized.startsWith('SELECT kek_hw_wrapped, encrypted_embed')) {
      const row = mockPersonnelRows.get(params[0] as string);
      return result(
        row
          ? [
              {
                kek_hw_wrapped: row.kek_hw_wrapped,
                encrypted_embed: row.encrypted_embed,
              },
            ]
          : [],
      );
    }

    if (normalized.startsWith('SELECT kek_hw_wrapped FROM personnel')) {
      const row = mockPersonnelRows.get(params[0] as string);
      return result(row ? [{kek_hw_wrapped: row.kek_hw_wrapped}] : []);
    }

    if (normalized.startsWith('SELECT ledger_id, encrypted_payload FROM attendance_ledger')) {
      return result(
        mockLedgerRows
          .filter(
            (row) =>
              row.personnel_id === params[0] &&
              row.event_counter != null &&
              row.encrypted_payload != null &&
              !row.payload_hash,
          )
          .map((row) => ({
            ledger_id: row.ledger_id,
            encrypted_payload: row.encrypted_payload,
          })),
      );
    }

    if (normalized.startsWith('UPDATE attendance_ledger SET payload_hash = ?')) {
      const row = mockLedgerRows.find((ledgerRow) => ledgerRow.ledger_id === params[1]);
      if (row) {
        row.payload_hash = params[0] as string;
      }
      return result();
    }

    if (normalized.startsWith('UPDATE attendance_ledger SET consent_withdrawn = 1')) {
      for (const row of mockLedgerRows) {
        if (row.personnel_id === params[0]) {
          row.consent_withdrawn = 1;
          row.personnel_id = null;
        }
      }
      return result();
    }

    if (normalized.startsWith('DELETE FROM lsh_index')) {
      mockLshRows = mockLshRows.filter((row) => row.personnel_id !== params[0]);
      return result();
    }

    if (normalized.startsWith('DELETE FROM consent_log')) {
      mockConsentRows = mockConsentRows.filter(
        (row) => row.personnel_id !== params[0],
      );
      return result();
    }

    if (normalized.startsWith('DELETE FROM personnel')) {
      mockPersonnelRows.delete(params[0] as string);
      return result();
    }

    if (normalized.startsWith('INSERT INTO lsh_index')) {
      mockLshRows.push({
        personnel_id: params[0] as string,
        bucket_key: params[1] as string,
        band_index: params[2] as number,
        signature: params[3] as string,
        updated_at: params[4] as string,
      });
      return result();
    }

    if (normalized.startsWith('SELECT DISTINCT personnel_id FROM lsh_index')) {
      return result(
        mockLshRows
          .filter(
            (row) =>
              row.bucket_key === params[0] && row.band_index === params[1],
          )
          .map((row) => ({personnel_id: row.personnel_id})),
      );
    }

    if (normalized.startsWith('SELECT personnel_id AS id FROM personnel')) {
      return result(
        Array.from(mockPersonnelRows.values())
          .filter((row) => row.enrollment_status === 'active')
          .map((row) => ({id: row.personnel_id})),
      );
    }

    if (normalized.startsWith('INSERT INTO personnel')) {
      const row: PersonnelRow = {
        personnel_id: params[0] as string,
        full_name: params[1] as string,
        role: params[2] as string,
        encrypted_embed: params[3] as string,
        kek_hw_wrapped: params[4] as string,
        kek_admin_wrapped: params[5] as string,
        admin_key_version: params[6] as number,
        enrollment_ts: params[7] as number,
        consent_ts: params[8] as number,
        enrollment_status: 'active',
      };
      mockPersonnelRows.set(row.personnel_id, row);
      return result();
    }

    if (normalized.startsWith('INSERT INTO consent_log')) {
      mockConsentRows.push({
        id: params[0],
        personnel_id: params[1],
        consent_ts: params[2],
      });
      return result();
    }

    if (normalized.startsWith('SELECT current_hash FROM attendance_ledger')) {
      const latest = [...mockLedgerRows].sort(
        (a, b) => Number(b.event_counter) - Number(a.event_counter),
      )[0];
      return result(latest ? [{current_hash: latest.current_hash}] : []);
    }

    if (normalized.startsWith('INSERT INTO attendance_ledger')) {
      mockLedgerRows.push({
        ledger_id: params[0] as string,
        id: params[1],
        personnel_id: params[2] as string,
        event_type: params[3],
        captured_at: params[4],
        device_id: params[5],
        confidence: params[6],
        liveness_score: null,
        payload_json: params[7],
        payload_hash: params[8] as string,
        encrypted_payload: params[9] as string | null,
        previous_hash: params[10],
        prev_hash: params[11],
        current_hash: params[12],
        chain_index: params[13],
        ts: params[14],
        uptime_ms: params[15],
        event_counter: params[16] as number,
        synced: 0,
        consent_withdrawn: 0,
        created_at: params[17],
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

    if (normalized.startsWith('SELECT * FROM personnel WHERE personnel_id = ?')) {
      const row = mockPersonnelRows.get(params[0] as string);
      return result(row ? [{...row}] : []);
    }

    if (normalized.startsWith('SELECT * FROM lsh_index WHERE personnel_id = ?')) {
      return result(
        mockLshRows
          .filter((row) => row.personnel_id === params[0])
          .map((row) => ({...row})),
      );
    }

    if (normalized.startsWith('SELECT * FROM consent_log WHERE personnel_id = ?')) {
      return result(
        mockConsentRows
          .filter((row) => row.personnel_id === params[0])
          .map((row) => ({...row})),
      );
    }

    if (normalized.startsWith('SELECT * FROM attendance_ledger WHERE personnel_id = ?')) {
      return result(
        mockLedgerRows
          .filter((row) => row.personnel_id === params[0])
          .map((row) => ({...row})),
      );
    }

    if (normalized.startsWith('SELECT ledger_id, personnel_id, consent_withdrawn FROM attendance_ledger')) {
      const ids = new Set(params as string[]);
      return result(
        mockLedgerRows
          .filter((row) => ids.has(row.ledger_id))
          .sort((a, b) => a.ledger_id.localeCompare(b.ledger_id))
          .map((row) => ({
            ledger_id: row.ledger_id,
            personnel_id: row.personnel_id,
            consent_withdrawn: row.consent_withdrawn,
          })),
      );
    }

    throw new Error(`Unexpected SQL in erasure test: ${normalized}`);
  }),
};

jest.mock('../../../src/storage/database/DatabaseManager', () => ({
  getDatabase: () => mockDb,
}));

const {NativeSecureKey} = require('../../../src/crypto/NativeSecureKey');
const {EnrollmentService} = require('../../../src/storage/EnrollmentService');
const {
  ErasureService,
  ERASURE_MMKV_ID,
  PENDING_ERASURES_KEY,
  PENDING_RECEIPTS_KEY,
  ORPHAN_KEYS_KEY,
} = require('../../../src/storage/ErasureService');
const {EventCounter} = require('../../../src/storage/EventCounter');
const {LedgerService} = require('../../../src/storage/LedgerService');
const {LSHIndex} = require('../../../src/storage/LSHIndex');
const {VerificationService} = require('../../../src/storage/VerificationService');

function normalisedEmbedding(seed: number): Float32Array {
  const embedding = new Float32Array(128);
  for (let i = 0; i < embedding.length; i += 1) {
    embedding[i] = ((seed + i * 13) % 17) + 1;
  }
  const norm = Math.sqrt(
    Array.from(embedding).reduce((sum, value) => sum + value * value, 0),
  );
  for (let i = 0; i < embedding.length; i += 1) {
    embedding[i] /= norm;
  }
  return embedding;
}

async function enrollFixture(
  personnelId: string,
  name: string,
  embedding = normalisedEmbedding(101),
): Promise<Float32Array> {
  await EnrollmentService.enroll({
    personnelId,
    name,
    department: 'Field Ops',
    embedding,
    consentTs: Date.now(),
  });
  return embedding;
}

function erasureRequest(
  personnelId: string,
  confirmedName: string,
): ErasureRequest {
  return {
    personnelId,
    confirmedName,
    requestedBy: 'admin-uuid-1',
    requestedAt: Date.now(),
  };
}

function erasureStore(): Map<string, unknown> {
  return mockGetStore(ERASURE_MMKV_ID);
}

function pendingReceipts(): Array<Record<string, unknown>> {
  return JSON.parse(
    (erasureStore().get(PENDING_RECEIPTS_KEY) as string | undefined) ?? '[]',
  );
}

function query(sql: string, params: unknown[] = []) {
  return mockDb.executeSync(sql, params).rows;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockBuildAndSignReceipt.mockReset();
  mockBuildAndSignReceipt.mockImplementation(
    async (personnelId: string, commandNonce: string) => ({
      personnel_id: personnelId,
      device_id: 'device-public-key-base64',
      purge_ts: 1700000000000,
      uptime_ms: 12345,
      command_nonce: commandNonce,
      signature: `signature:${personnelId}:${commandNonce}`,
    }),
  );
  mockUploadDeletionReceipt.mockReset();
  mockUploadDeletionReceipt.mockResolvedValue({success: true});
  for (const store of mockMmkvStores.values()) {
    store.clear();
  }
  mockPersonKeys.clear();
  mockWrappedDeks.clear();
  mockDestroyFailures.clear();
  mockPersonnelRows.clear();
  mockConsentRows = [];
  mockLshRows = [];
  mockLedgerRows = [];
  mockAnchorRows = [];
  mockFailCommit = false;
  transactionSnapshot = null;
  mockUptimeMs = 1000;
  mockNetInfo.fetch.mockResolvedValue({isConnected: true});
  EventCounter.resetForTests();
  LSHIndex.resetForTests();
});

describe('T3.6 biometric erasure', () => {
  it('rejects a confirmed-name mismatch before touching DB or Keystore', async () => {
    await enrollFixture('person-name-guard', 'Asha Rao');
    const before = snapshotTables();

    await expect(
      ErasureService.execute(erasureRequest('person-name-guard', 'Wrong Name')),
    ).rejects.toThrow('NAME_MISMATCH');

    expect(mockPersonnelRows.has('person-name-guard')).toBe(true);
    expect(mockLshRows).toEqual(before.lshRows);
    expect(mockConsentRows).toEqual(before.consentRows);
    expect(mockLedgerRows).toEqual(before.ledgerRows);
    expect(NativeSecureKey.destroyPersonKey).not.toHaveBeenCalled();
  });

  it('executes full soft and hard purge and removes LSH candidates', async () => {
    const embedding = await enrollFixture('person-full', 'Meera Iyer');
    const beforeCandidates = await LSHIndex.query({liveEmbedding: embedding});
    expect(beforeCandidates.map((candidate: any) => candidate.personnelId)).toContain(
      'person-full',
    );

    const wrapped = mockWrappedDeks.get('person-full')!;
    const resultValue = await ErasureService.execute({
      ...erasureRequest('person-full', 'Meera Iyer'),
      commandNonce: 'delete-command-nonce-1',
    });

    expect(resultValue).toMatchObject({
      personnelId: 'person-full',
      softPurgeComplete: true,
      hardPurgeComplete: true,
    });
    expect(query('SELECT * FROM personnel WHERE personnel_id = ?;', ['person-full'])).toHaveLength(0);
    expect(query('SELECT * FROM lsh_index WHERE personnel_id = ?;', ['person-full'])).toHaveLength(0);
    expect(query('SELECT * FROM consent_log WHERE personnel_id = ?;', ['person-full'])).toHaveLength(0);
    expect(query('SELECT * FROM attendance_ledger WHERE personnel_id = ?;', ['person-full'])).toHaveLength(0);

    const afterCandidates = await LSHIndex.query({liveEmbedding: embedding});
    expect(afterCandidates.map((candidate: any) => candidate.personnelId)).not.toContain(
      'person-full',
    );
    await expect(
      NativeSecureKey.unwrapDEK('person-full', wrapped),
    ).rejects.toThrow('KEY_NOT_FOUND');
    expect(mockBuildAndSignReceipt).toHaveBeenCalledWith(
      'person-full',
      'delete-command-nonce-1',
    );
    expect(mockUploadDeletionReceipt).toHaveBeenCalledWith(
      expect.objectContaining({
        personnel_id: 'person-full',
        command_nonce: 'delete-command-nonce-1',
        signature: 'signature:person-full:delete-command-nonce-1',
      }),
    );
    await expect(LedgerService.verifyChain()).resolves.toMatchObject({ok: true});
  });

  it('queues signed deletion receipts when compliance upload fails', async () => {
    await enrollFixture('person-receipt-queue', 'Nila Roy');
    mockUploadDeletionReceipt.mockRejectedValueOnce(
      new Error('RECEIPT_UPLOAD_FAILED'),
    );

    await ErasureService.execute({
      ...erasureRequest('person-receipt-queue', 'Nila Roy'),
      commandNonce: 'delete-command-nonce-2',
    });

    expect(pendingReceipts()).toEqual([
      expect.objectContaining({
        personnel_id: 'person-receipt-queue',
        command_nonce: 'delete-command-nonce-2',
        signature: 'signature:person-receipt-queue:delete-command-nonce-2',
      }),
    ]);
  });

  it('drains queued deletion receipts for retry', async () => {
    const queuedReceipt = {
      personnel_id: 'person-retry',
      device_id: 'device-public-key-base64',
      purge_ts: 1700000000000,
      uptime_ms: 12345,
      command_nonce: 'delete-command-nonce-3',
      signature: 'signature:person-retry:delete-command-nonce-3',
    };
    erasureStore().set(PENDING_RECEIPTS_KEY, JSON.stringify([queuedReceipt]));

    await expect(ErasureService.drainPendingReceipts()).resolves.toEqual({
      uploaded: 1,
      failed: [],
    });

    expect(mockUploadDeletionReceipt).toHaveBeenCalledWith(queuedReceipt);
    expect(pendingReceipts()).toEqual([]);
  });

  it('anonymises attendance ledger rows while preserving history', async () => {
    await enrollFixture('person-ledger', 'Neel Shah');
    const ledgerEvents = [];
    for (let i = 0; i < 3; i += 1) {
      ledgerEvents.push(
        await LedgerService.recordEvent({
          personnelId: 'person-ledger',
          eventType: 'VERIFICATION',
          matchScore: 0.91,
          deviceId: 'device-test',
        }),
      );
    }

    await ErasureService.execute(erasureRequest('person-ledger', 'Neel Shah'));

    const rows = query(
      'SELECT ledger_id, personnel_id, consent_withdrawn FROM attendance_ledger WHERE ledger_id IN (?, ?, ?) ORDER BY ledger_id;',
      ledgerEvents.map((event) => event.ledgerId),
    );
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.personnel_id).toBeNull();
      expect(row.consent_withdrawn).toBe(1);
    }
  });

  it('rolls back SQL and skips receipts when COMMIT fails after hard purge', async () => {
    await enrollFixture('person-soft-fail', 'Dev Patel');
    mockFailCommit = true;

    await expect(
      ErasureService.execute(erasureRequest('person-soft-fail', 'Dev Patel')),
    ).rejects.toThrow('SOFT_PURGE_FAILED');

    expect(mockPersonnelRows.has('person-soft-fail')).toBe(true);
    expect(NativeSecureKey.destroyPersonKey).toHaveBeenCalledWith(
      'person-soft-fail',
    );
    expect(mockBuildAndSignReceipt).not.toHaveBeenCalled();
    expect(mockUploadDeletionReceipt).not.toHaveBeenCalled();
  });

  it('rolls back SQL and skips receipts when hard purge fails', async () => {
    await enrollFixture('person-hard-fail', 'Ira Menon');
    mockDestroyFailures.add('person-hard-fail');

    await expect(
      ErasureService.execute(erasureRequest('person-hard-fail', 'Ira Menon')),
    ).rejects.toThrow('HARD_PURGE_FAILED');

    expect(mockPersonnelRows.has('person-hard-fail')).toBe(true);
    const orphanQueue = JSON.parse(
      (erasureStore().get(ORPHAN_KEYS_KEY) as string | undefined) ?? '[]',
    );
    expect(orphanQueue).toEqual([]);
    expect(mockBuildAndSignReceipt).not.toHaveBeenCalled();
    expect(mockUploadDeletionReceipt).not.toHaveBeenCalled();
  });

  it('queues offline erasure and drains it later', async () => {
    await enrollFixture('person-offline', 'Ravi Kumar');
    mockNetInfo.fetch.mockResolvedValueOnce({isConnected: false});

    await expect(
      ErasureService.requestErasure(erasureRequest('person-offline', 'Ravi Kumar')),
    ).resolves.toMatchObject({status: 'QUEUED'});

    expect(
      JSON.parse((erasureStore().get(PENDING_ERASURES_KEY) as string) ?? '[]'),
    ).toHaveLength(1);

    const drainResult = await ErasureService.drainOfflineQueue();

    expect(drainResult.executed).toHaveLength(1);
    expect(drainResult.failed).toEqual([]);
    expect(
      JSON.parse((erasureStore().get(PENDING_ERASURES_KEY) as string) ?? '[]'),
    ).toHaveLength(0);
    expect(mockPersonnelRows.has('person-offline')).toBe(false);
    await expect(
      NativeSecureKey.unwrapDEK(
        'person-offline',
        mockWrappedDeks.get('person-offline')!,
      ),
    ).rejects.toThrow('KEY_NOT_FOUND');
  });

  it('keeps other personnel discoverable after one person is erased', async () => {
    const personAEmbedding = await enrollFixture(
      'person-a',
      'Aditi Sen',
      normalisedEmbedding(201),
    );
    await enrollFixture('person-b', 'Kabir Das', normalisedEmbedding(301));

    await ErasureService.execute(erasureRequest('person-a', 'Aditi Sen'));

    const candidates = await VerificationService.findCandidates(personAEmbedding);
    const candidateIds = candidates.map((candidate: any) => candidate.personnelId);

    expect(candidateIds).not.toContain('person-a');
    expect(candidateIds).toContain('person-b');
  });

  it('preserves ledger chain integrity after erasure', async () => {
    await enrollFixture('person-chain', 'Tara Bose');
    await ErasureService.execute(erasureRequest('person-chain', 'Tara Bose'));

    await expect(LedgerService.verifyChain()).resolves.toEqual({
      ok: true,
      totalRecords: 2,
    });
  });
});
