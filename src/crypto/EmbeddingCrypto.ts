import {NativeModules} from 'react-native';

import {
  base64ToBytes,
  bytesToBase64,
  concatBytes,
  hexToBytes,
  utf8ToBytes,
} from '../utils/BufferUtils';

const GCM_IV_BYTES = 12;
const GCM_TAG_BYTES = 16;
const GCM_TAG_BITS = 128;

type EmbeddingCryptoNativeModule = {
  encrypt: (
    embeddingBase64: string,
    personnelId: string,
    dekHex: string,
  ) => Promise<string>;
  decrypt: (
    encryptedBlobBase64: string,
    personnelId: string,
    dekHex: string,
  ) => Promise<string>;
};

function getNativeModule(): EmbeddingCryptoNativeModule | null {
  const module =
    NativeModules.EmbeddingCrypto ??
    NativeModules.NativeBridge ??
    NativeModules.SecureEnclaveManager;

  if (
    module &&
    typeof module.encrypt === 'function' &&
    typeof module.decrypt === 'function'
  ) {
    return module as EmbeddingCryptoNativeModule;
  }

  return null;
}

function getSubtle(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error(
      '[EmbeddingCrypto] Native module is unavailable and WebCrypto subtle is not installed.',
    );
  }
  return subtle;
}

function getRandomIV(): Uint8Array {
  const iv = new Uint8Array(GCM_IV_BYTES);
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error(
      '[EmbeddingCrypto] crypto.getRandomValues is required for AES-GCM IV generation.',
    );
  }
  globalThis.crypto.getRandomValues(iv);
  return iv;
}

async function importAESKey(dekHex: string): Promise<CryptoKey> {
  const dek = hexToBytes(dekHex);
  if (dek.byteLength !== 32) {
    dek.fill(0);
    throw new Error(`[EmbeddingCrypto] Expected 32-byte DEK, got ${dek.byteLength}.`);
  }

  try {
    return await getSubtle().importKey('raw', dek, 'AES-GCM', false, [
      'encrypt',
      'decrypt',
    ]);
  } finally {
    dek.fill(0);
  }
}

async function encryptWithWebCrypto(
  embeddingBase64: string,
  personnelId: string,
  dekHex: string,
): Promise<string> {
  const plaintext = base64ToBytes(embeddingBase64);
  if (plaintext.byteLength === 0) {
    throw new Error('[EmbeddingCrypto] Plaintext must not be empty.');
  }

  const iv = getRandomIV();
  const key = await importAESKey(dekHex);

  try {
    const ciphertextAndTag = await getSubtle().encrypt(
      {
        name: 'AES-GCM',
        iv,
        additionalData: utf8ToBytes(personnelId),
        tagLength: GCM_TAG_BITS,
      },
      key,
      plaintext,
    );

    const blob = concatBytes([iv, new Uint8Array(ciphertextAndTag)]);
    return bytesToBase64(blob);
  } finally {
    plaintext.fill(0);
  }
}

async function decryptWithWebCrypto(
  encryptedBlobBase64: string,
  personnelId: string,
  dekHex: string,
): Promise<string> {
  const blob = base64ToBytes(encryptedBlobBase64);
  if (blob.byteLength <= GCM_IV_BYTES + GCM_TAG_BYTES) {
    throw new Error(
      `[EmbeddingCrypto] Encrypted blob is too short (${blob.byteLength} bytes).`,
    );
  }

  const iv = blob.slice(0, GCM_IV_BYTES);
  const ciphertextAndTag = blob.slice(GCM_IV_BYTES);
  const key = await importAESKey(dekHex);
  const plaintext = await getSubtle().decrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: utf8ToBytes(personnelId),
      tagLength: GCM_TAG_BITS,
    },
    key,
    ciphertextAndTag,
  );

  const bytes = new Uint8Array(plaintext);
  return bytesToBase64(bytes);
}

export const EmbeddingCrypto = {
  async encrypt(
    embeddingBase64: string,
    personnelId: string,
    dekHex: string,
  ): Promise<string> {
    const nativeModule = getNativeModule();
    if (nativeModule) {
      return nativeModule.encrypt(embeddingBase64, personnelId, dekHex);
    }

    return encryptWithWebCrypto(embeddingBase64, personnelId, dekHex);
  },

  async decrypt(
    encryptedBlobBase64: string,
    personnelId: string,
    dekHex: string,
  ): Promise<string> {
    const nativeModule = getNativeModule();
    if (nativeModule) {
      return nativeModule.decrypt(encryptedBlobBase64, personnelId, dekHex);
    }

    return decryptWithWebCrypto(encryptedBlobBase64, personnelId, dekHex);
  },
};
