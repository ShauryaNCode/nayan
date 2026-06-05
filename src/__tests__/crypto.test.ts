import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  webcrypto,
} from 'crypto';

import {
  base64ToBytes,
  bytesToHex,
  float32ToBase64,
} from '../utils/BufferUtils';

Object.defineProperty(globalThis, 'crypto', {
  value: webcrypto,
  configurable: true,
});

const mockKek = randomBytes(32);

function mockAesGcmEncrypt(
  plaintext: Uint8Array,
  key: Uint8Array,
  aad: string,
): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(key), iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(plaintext)),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, ciphertext, tag]).toString('base64');
}

function mockAesGcmDecrypt(
  encryptedBase64: string,
  key: Uint8Array,
  aad: string,
): Uint8Array {
  const blob = Buffer.from(encryptedBase64, 'base64');
  const iv = blob.subarray(0, 12);
  const ciphertext = blob.subarray(12, blob.length - 16);
  const tag = blob.subarray(blob.length - 16);
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(key), iv);
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(tag);
  return new Uint8Array(
    Buffer.concat([decipher.update(ciphertext), decipher.final()]),
  );
}

jest.mock('react-native', () => ({
  NativeModules: {
    NativeBridge: {
      generatePersonKey: jest.fn(async () => undefined),
      wrapDEK: jest.fn(async (personnelId: string, dekHex: string) =>
        mockAesGcmEncrypt(
          new Uint8Array(Buffer.from(dekHex, 'hex')),
          mockKek,
          personnelId,
        ),
      ),
      unwrapDEK: jest.fn(
        async (personnelId: string, wrappedDEKBase64: string) =>
          Buffer.from(
            mockAesGcmDecrypt(wrappedDEKBase64, mockKek, personnelId),
          ).toString('hex'),
      ),
    },
    EmbeddingCrypto: undefined,
    SecureEnclaveManager: undefined,
  },
  TurboModuleRegistry: {
    get: jest.fn(() => null),
  },
  Platform: {
    OS: 'android',
  },
}));

import {EmbeddingCrypto} from '../crypto/EmbeddingCrypto';
import {NativeSecureKey} from '../crypto/NativeSecureKey';

function knownEmbedding(): Float32Array {
  const embedding = new Float32Array(128);
  for (let i = 0; i < embedding.length; i += 1) {
    embedding[i] = Math.fround(Math.sin(i + 1) / 16);
  }
  return embedding;
}

function embeddingBytes(embedding: Float32Array): Uint8Array {
  return new Uint8Array(
    embedding.buffer,
    embedding.byteOffset,
    embedding.byteLength,
  );
}

describe('embedding crypto primitives', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('AES-256-GCM round-trips a known 128-float embedding byte-for-byte', async () => {
    const embedding = knownEmbedding();
    const dekHex = bytesToHex(randomBytes(32));
    const plaintextBase64 = float32ToBase64(embedding);

    const encrypted = await EmbeddingCrypto.encrypt(
      plaintextBase64,
      'person-uuid-A',
      dekHex,
    );
    const decrypted = await EmbeddingCrypto.decrypt(
      encrypted,
      'person-uuid-A',
      dekHex,
    );

    expect(bytesToHex(base64ToBytes(decrypted))).toBe(
      bytesToHex(embeddingBytes(embedding)),
    );
  });

  it('binds ciphertext to AAD', async () => {
    const dekHex = bytesToHex(randomBytes(32));
    const encrypted = await EmbeddingCrypto.encrypt(
      float32ToBase64(knownEmbedding()),
      'person-uuid-A',
      dekHex,
    );

    await expect(
      EmbeddingCrypto.decrypt(encrypted, 'person-uuid-B', dekHex),
    ).rejects.toThrow();
  });

  it('wraps and unwraps a DEK with a software KEK in Jest', async () => {
    const personnelId = 'person-uuid-wrap';
    const dekHex = bytesToHex(randomBytes(32));

    await NativeSecureKey.generatePersonKey(personnelId);
    const wrapped = await NativeSecureKey.wrapDEK(personnelId, dekHex);
    const unwrapped = await NativeSecureKey.unwrapDEK(personnelId, wrapped);

    expect(unwrapped).toBe(dekHex);
  });
});
