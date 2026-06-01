import {NativeModules, Platform} from 'react-native';
import {MMKV} from 'react-native-mmkv';

export const DATABASE_KEY_ALIAS = 'offline_face_auth_db_v1';
export const DATABASE_KEY_MMKV_ID = 'nayan.secure-storage.db-key-v1';
export const DATABASE_NONCE_KEY = 'sqlcipher.device_nonce.v1';
export const DATABASE_PASSPHRASE_KEY = 'sqlcipher.passphrase_envelope.v1';
export const DATABASE_NONCE_BYTES = 32;

export interface SQLCipherPassphraseResult {
  passphrase: string;
  nonceBase64: string;
  keyAlias: string;
  provider: string;
  envelopeVersion: number;
  restoredFromCache: boolean;
}

interface NativePassphraseResult {
  passphrase: string;
  keyAlias?: string;
  provider?: string;
  envelopeVersion?: number;
}

type DatabaseKeyNativeModule = {
  generateSecureRandomBase64: (byteLength: number) => Promise<string>;
  deriveDatabasePassphrase: (
    nonceBase64: string,
  ) => Promise<NativePassphraseResult | string>;
};

const storage = new MMKV({id: DATABASE_KEY_MMKV_ID});

function getNativeDatabaseKeyModule(): DatabaseKeyNativeModule {
  const module =
    NativeModules.SecureEnclaveManager ?? NativeModules.NativeBridge;

  if (
    !module ||
    typeof module.generateSecureRandomBase64 !== 'function' ||
    typeof module.deriveDatabasePassphrase !== 'function'
  ) {
    throw new Error(
      '[KeyDerivation] Native database key module is unavailable. ' +
        'Rebuild the app after linking NativeBridge/SecureEnclaveManager.',
    );
  }

  return module as DatabaseKeyNativeModule;
}

function getDefaultProvider(): string {
  if (Platform.OS === 'android') {
    return 'android_keystore';
  }

  if (Platform.OS === 'ios') {
    return 'ios_keychain';
  }

  return 'native_keystore';
}

async function getOrCreateDeviceNonce(
  nativeModule: DatabaseKeyNativeModule,
): Promise<string> {
  const existingNonce = storage.getString(DATABASE_NONCE_KEY);
  if (existingNonce) {
    return existingNonce;
  }

  const nonceBase64 = await nativeModule.generateSecureRandomBase64(
    DATABASE_NONCE_BYTES,
  );
  if (!nonceBase64 || nonceBase64.trim().length === 0) {
    throw new Error('[KeyDerivation] Native nonce generation returned empty.');
  }

  storage.set(DATABASE_NONCE_KEY, nonceBase64);
  return nonceBase64;
}

export async function deriveSQLCipherPassphrase(): Promise<SQLCipherPassphraseResult> {
  const nativeModule = getNativeDatabaseKeyModule();
  const nonceBase64 = await getOrCreateDeviceNonce(nativeModule);
  const cachedPassphrase = storage.getString(DATABASE_PASSPHRASE_KEY);

  if (cachedPassphrase) {
    return {
      passphrase: cachedPassphrase,
      nonceBase64,
      keyAlias: DATABASE_KEY_ALIAS,
      provider: getDefaultProvider(),
      envelopeVersion: 1,
      restoredFromCache: true,
    };
  }

  const nativeResult = await nativeModule.deriveDatabasePassphrase(nonceBase64);
  const normalizedResult: NativePassphraseResult =
    typeof nativeResult === 'string'
      ? {passphrase: nativeResult}
      : nativeResult;

  if (!normalizedResult.passphrase?.trim()) {
    throw new Error(
      '[KeyDerivation] Native passphrase derivation returned empty.',
    );
  }

  storage.set(DATABASE_PASSPHRASE_KEY, normalizedResult.passphrase);

  return {
    passphrase: normalizedResult.passphrase,
    nonceBase64,
    keyAlias: normalizedResult.keyAlias ?? DATABASE_KEY_ALIAS,
    provider: normalizedResult.provider ?? getDefaultProvider(),
    envelopeVersion: normalizedResult.envelopeVersion ?? 1,
    restoredFromCache: false,
  };
}

export function clearCachedSQLCipherPassphraseForTests(): void {
  storage.delete(DATABASE_NONCE_KEY);
  storage.delete(DATABASE_PASSPHRASE_KEY);
}
