import {
  createCipheriv,
  createDecipheriv,
  generateKeyPairSync,
  randomBytes,
  webcrypto,
} from 'crypto';

import {
  base64ToBytes,
  bytesToHex,
  float32ToBase64,
  hexToBytes,
} from '../../../src/utils/BufferUtils';

Object.defineProperty(globalThis, 'crypto', {
  value: webcrypto,
  configurable: true,
});

const mockAdminKeyPair = generateKeyPairSync('rsa', {
  modulusLength: 4096,
  publicKeyEncoding: {
    type: 'spki',
    format: 'pem',
  },
  privateKeyEncoding: {
    type: 'pkcs8',
    format: 'pem',
  },
});

const mockPersonKeys = new Map<string, Buffer>();

function aesGcmEncrypt(
  plaintext: Uint8Array,
  key: Uint8Array,
  aad?: string,
): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(key), iv);
  if (aad !== undefined) {
    cipher.setAAD(Buffer.from(aad, 'utf8'));
  }
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(plaintext)),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, ciphertext, tag]).toString('base64');
}

function aesGcmDecrypt(
  encryptedBase64: string,
  key: Uint8Array,
  aad?: string,
): Uint8Array {
  const blob = Buffer.from(encryptedBase64, 'base64');
  const iv = blob.subarray(0, 12);
  const ciphertext = blob.subarray(12, blob.length - 16);
  const tag = blob.subarray(blob.length - 16);
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(key), iv);
  if (aad !== undefined) {
    decipher.setAAD(Buffer.from(aad, 'utf8'));
  }
  decipher.setAuthTag(tag);
  return new Uint8Array(
    Buffer.concat([decipher.update(ciphertext), decipher.final()]),
  );
}

const mockNativeBridge = {
  generateSecureRandomBase64: jest.fn(async (byteLength: number) =>
    randomBytes(byteLength).toString('base64'),
  ),
  generatePersonKey: jest.fn(async (personnelId: string) => {
    if (mockPersonKeys.has(personnelId)) {
      throw new Error('duplicate person key');
    }
    mockPersonKeys.set(personnelId, randomBytes(32));
  }),
  wrapDEK: jest.fn(async (personnelId: string, dekHex: string) => {
    const key = mockPersonKeys.get(personnelId);
    if (!key) {
      throw new Error('missing person key');
    }
    return aesGcmEncrypt(hexToBytes(dekHex), key);
  }),
  unwrapDEK: jest.fn(async (personnelId: string, wrappedDEKBase64: string) => {
    const key = mockPersonKeys.get(personnelId);
    if (!key) {
      throw new Error('missing person key');
    }
    return bytesToHex(aesGcmDecrypt(wrappedDEKBase64, key));
  }),
  deletePersonKey: jest.fn(async (personnelId: string) => {
    mockPersonKeys.delete(personnelId);
  }),
};

const mockLSHModule = {
  loadHyperplanes: jest.fn(async () => undefined),
  computeBucketKeys: jest.fn(async () => ['0_1', '1_2', '2_3', '3_4']),
};

jest.mock('react-native', () => ({
  NativeModules: {
    NativeBridge: mockNativeBridge,
    SecureEnclaveManager: undefined,
    EmbeddingCrypto: undefined,
    LSHModule: mockLSHModule,
  },
  TurboModuleRegistry: {
    get: jest.fn((name: string) =>
      name === 'LSHModule' ? mockLSHModule : null,
    ),
  },
  Platform: {
    OS: 'android',
  },
}));

jest.mock('../../../src/crypto/AdminKey', () => ({
  ADMIN_KEY_VERSION: 1,
  ADMIN_PUBLIC_KEY_PEM: mockAdminKeyPair.publicKey,
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

const mockPersonnelRows = new Map<string, PersonnelRow>();
const mockConsentRows: Array<Record<string, unknown>> = [];
const mockLshRows: Array<Record<string, unknown>> = [];

const mockFakeDb = {
  executeSync: jest.fn((sql: string, params: unknown[] = []) => {
    const normalized = sql.replace(/\s+/g, ' ').trim();

    if (
      normalized === 'BEGIN IMMEDIATE;' ||
      normalized === 'COMMIT;' ||
      normalized === 'ROLLBACK;' ||
      normalized === 'PRAGMA defer_foreign_keys=ON;'
    ) {
      return {rows: [], rowsAffected: 0};
    }

    if (normalized === 'PRAGMA table_info(lsh_index);') {
      return {
        rows: [
          {name: 'bucket_key'},
          {name: 'personnel_id'},
          {name: 'band_index'},
          {name: 'signature'},
          {name: 'updated_at'},
        ],
        rowsAffected: 0,
      };
    }

    if (normalized.startsWith('INSERT INTO lsh_index')) {
      mockLshRows.push({
        personnel_id: params[0],
        bucket_key: params[1],
        band_index: params[2],
        signature: params[3],
        updated_at: params[4],
      });
      return {rows: [], rowsAffected: 1};
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
      return {rows: [], rowsAffected: 1};
    }

    if (normalized.startsWith('INSERT INTO consent_log')) {
      mockConsentRows.push({
        id: params[0],
        personnel_id: params[1],
        consent_ts: params[2],
      });
      return {rows: [], rowsAffected: 1};
    }

    if (normalized.startsWith('SELECT kek_hw_wrapped, encrypted_embed')) {
      const row = mockPersonnelRows.get(params[0] as string);
      return {
        rows: row
          ? [
              {
                kek_hw_wrapped: row.kek_hw_wrapped,
                encrypted_embed: row.encrypted_embed,
              },
            ]
          : [],
        rowsAffected: 0,
      };
    }

    if (normalized.startsWith('UPDATE personnel SET encrypted_embed')) {
      const row = mockPersonnelRows.get(params[1] as string);
      if (row) {
        row.encrypted_embed = params[0] as string;
      }
      return {rows: [], rowsAffected: row ? 1 : 0};
    }

    throw new Error(`Unexpected SQL in test: ${normalized}`);
  }),
};

jest.mock('../../../src/storage/database/DatabaseManager', () => ({
  getDatabase: () => mockFakeDb,
}));

const {AdminEscrow} = require('../../../src/crypto/AdminEscrow');
const {EmbeddingCrypto} = require('../../../src/crypto/EmbeddingCrypto');
const {EnrollmentService} = require('../../../src/storage/EnrollmentService');
const {VerificationService} = require('../../../src/storage/VerificationService');

function normalizedHalfVector(): Float32Array {
  const embedding = new Float32Array(128);
  embedding.fill(0.5);
  const norm = Math.sqrt(
    Array.from(embedding).reduce((sum, value) => sum + value * value, 0),
  );
  for (let i = 0; i < embedding.length; i += 1) {
    embedding[i] /= norm;
  }
  return embedding;
}

function vectorWithValue(value: number): Float32Array {
  const embedding = new Float32Array(128);
  embedding.fill(value);
  const norm = Math.sqrt(
    Array.from(embedding).reduce((sum, entry) => sum + entry * entry, 0),
  );
  for (let i = 0; i < embedding.length; i += 1) {
    embedding[i] /= norm;
  }
  return embedding;
}

async function enrollFixture(
  personnelId: string,
  embedding: Float32Array,
): Promise<void> {
  await EnrollmentService.enroll({
    personnelId,
    name: `Person ${personnelId}`,
    department: 'Field Ops',
    embedding,
    consentTs: Date.now(),
  });
}

function expectVectorsClose(actual: Float32Array, expected: Float32Array): void {
  expect(actual).toHaveLength(expected.length);
  for (let i = 0; i < expected.length; i += 1) {
    expect(actual[i]).toBeCloseTo(expected[i], 4);
  }
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPersonKeys.clear();
  mockPersonnelRows.clear();
  mockConsentRows.length = 0;
  mockLshRows.length = 0;
});

describe('T3.2 per-person embedding crypto', () => {
  it('round-trips an enrolled embedding', async () => {
    const embedding = normalizedHalfVector();
    await enrollFixture('person-round-trip', embedding);

    const decrypted = await VerificationService.decryptEmbedding(
      'person-round-trip',
    );

    expectVectorsClose(decrypted, embedding);
  });

  it('rejects a row-swap attack through AES-GCM AAD binding', async () => {
    const personAEmbedding = vectorWithValue(0.125);
    const personBEmbedding = vectorWithValue(0.25);
    await enrollFixture('person-a', personAEmbedding);
    await enrollFixture('person-b', personBEmbedding);

    const personA = mockPersonnelRows.get('person-a')!;
    const personB = mockPersonnelRows.get('person-b')!;

    mockFakeDb.executeSync(
      'UPDATE personnel SET encrypted_embed = ? WHERE personnel_id = ?;',
      [personB.encrypted_embed, 'person-a'],
    );
    mockFakeDb.executeSync(
      'UPDATE personnel SET encrypted_embed = ? WHERE personnel_id = ?;',
      [personA.encrypted_embed, 'person-b'],
    );

    await expect(
      VerificationService.decryptEmbedding('person-a'),
    ).rejects.toThrow();
  });

  it('zeros the JS DEK buffer after enrollment returns', async () => {
    await enrollFixture('person-zeroing', normalizedHalfVector());

    const snapshot =
      EnrollmentService.getLastZeroedDEKSnapshotForTests();

    expect(snapshot).toHaveLength(32);
    expect(snapshot?.every((byte) => byte === 0)).toBe(true);
  });

  it('recovers an embedding through admin escrow without the hardware key', async () => {
    const embedding = normalizedHalfVector();
    await enrollFixture('person-admin', embedding);
    const row = mockPersonnelRows.get('person-admin')!;

    mockPersonKeys.delete('person-admin');

    const recovered = await AdminEscrow.recoverEmbedding({
      personnelId: 'person-admin',
      kek_admin_wrapped: row.kek_admin_wrapped,
      encrypted_embed: row.encrypted_embed,
      adminPrivateKeyPEM: mockAdminKeyPair.privateKey,
    });

    expectVectorsClose(recovered, embedding);
  });

  it('rejects decrypt with a wrong DEK', async () => {
    const embeddingBase64 = float32ToBase64(normalizedHalfVector());
    const correctDEK = bytesToHex(randomBytes(32));
    const wrongDEK = bytesToHex(randomBytes(32));
    const encrypted = await EmbeddingCrypto.encrypt(
      embeddingBase64,
      'person-wrong-dek',
      correctDEK,
    );

    expect(base64ToBytes(encrypted)).toHaveLength(540);
    await expect(
      EmbeddingCrypto.decrypt(encrypted, 'person-wrong-dek', wrongDEK),
    ).rejects.toThrow();
  });
});
