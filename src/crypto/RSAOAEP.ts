import {
  base64ToBytes,
  bytesToBase64,
} from '../utils/BufferUtils';

const RSA_OAEP_PARAMS = {
  name: 'RSA-OAEP',
  hash: 'SHA-256',
} as const;

type SubtleLike = SubtleCrypto;

function getSubtle(): SubtleLike {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error(
      '[RSAOAEP] WebCrypto subtle is unavailable. Install/enable the Hermes Web Crypto polyfill.',
    );
  }
  return subtle;
}

function pemToDerBytes(pem: string, label: 'PUBLIC KEY' | 'PRIVATE KEY'): Uint8Array {
  const header = `-----BEGIN ${label}-----`;
  const footer = `-----END ${label}-----`;
  const trimmed = pem.trim();

  if (!trimmed.includes(header) || !trimmed.includes(footer)) {
    throw new Error(`[RSAOAEP] Expected PEM block: ${label}.`);
  }

  const base64Body = trimmed
    .replace(header, '')
    .replace(footer, '')
    .replace(/\s/g, '');

  return base64ToBytes(base64Body);
}

async function importPublicKey(publicKeyPEM: string): Promise<CryptoKey> {
  if (publicKeyPEM.includes('REPLACE_WITH_ADMIN_RSA_4096_PUBLIC_KEY')) {
    throw new Error(
      '[RSAOAEP] Admin public key placeholder is still present. Generate the RSA-4096 key pair and paste admin_public.pem into AdminKey.ts.',
    );
  }

  const subtle = getSubtle();
  const der = pemToDerBytes(publicKeyPEM, 'PUBLIC KEY');
  return subtle.importKey('spki', der, RSA_OAEP_PARAMS, false, ['encrypt']);
}

async function importPrivateKey(privateKeyPEM: string): Promise<CryptoKey> {
  const subtle = getSubtle();
  const der = pemToDerBytes(privateKeyPEM, 'PRIVATE KEY');
  return subtle.importKey('pkcs8', der, RSA_OAEP_PARAMS, false, ['decrypt']);
}

export async function wrapDEKWithAdminPublicKey(
  dek: Uint8Array,
  publicKeyPEM: string,
): Promise<string> {
  if (dek.byteLength !== 32) {
    throw new Error(`[RSAOAEP] Expected 32-byte DEK, got ${dek.byteLength}.`);
  }

  const key = await importPublicKey(publicKeyPEM);
  const wrapped = await getSubtle().encrypt(RSA_OAEP_PARAMS, key, dek);
  return bytesToBase64(new Uint8Array(wrapped));
}

export async function unwrapDEKWithAdminPrivateKey(
  wrappedDEKBase64: string,
  privateKeyPEM: string,
): Promise<Uint8Array> {
  const key = await importPrivateKey(privateKeyPEM);
  const wrapped = base64ToBytes(wrappedDEKBase64);
  const unwrapped = await getSubtle().decrypt(RSA_OAEP_PARAMS, key, wrapped);
  const dek = new Uint8Array(unwrapped);

  if (dek.byteLength !== 32) {
    dek.fill(0);
    throw new Error(`[RSAOAEP] Expected 32-byte DEK, got ${dek.byteLength}.`);
  }

  return dek;
}
