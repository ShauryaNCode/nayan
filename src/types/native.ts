export interface NativeDatabasePassphraseResult {
  passphrase: string;
  keyAlias: string;
  provider: string;
  envelopeVersion: number;
}

export interface NativeBridgeModule {
  initializeEngine: (modelPath?: string) => Promise<void>;
  ensureJsiInstalled: () => Promise<boolean>;
  enqueueFrame?: (
    buffer: ArrayBuffer,
    width: number,
    height: number,
    stride: number,
    timestampNs: number,
  ) => Promise<boolean>;
  setLivenessPassed?: (passed: boolean) => Promise<void>;
  setLivenessState?: (state: string) => Promise<void>;
  generateSecureRandomBase64: (byteLength: number) => Promise<string>;
  deriveDatabasePassphrase: (
    nonceBase64: string,
  ) => Promise<NativeDatabasePassphraseResult>;
  generatePersonKey: (personnelId: string) => Promise<void>;
  wrapDEK: (personnelId: string, dekHex: string) => Promise<string>;
  unwrapDEK: (
    personnelId: string,
    wrappedDEKBase64: string,
  ) => Promise<string>;
  deletePersonKey?: (personnelId: string) => Promise<boolean | void>;
}

export interface SecureEnclaveManagerModule {
  generateSecureRandomBase64: (byteLength: number) => Promise<string>;
  deriveDatabasePassphrase: (
    nonceBase64: string,
  ) => Promise<NativeDatabasePassphraseResult>;
  generatePersonKey: (personnelId: string) => Promise<void>;
  wrapDEK: (personnelId: string, dekHex: string) => Promise<string>;
  unwrapDEK: (
    personnelId: string,
    wrappedDEKBase64: string,
  ) => Promise<string>;
  deletePersonKey?: (personnelId: string) => Promise<boolean | void>;
}

export interface EmbeddingCryptoModule {
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
}
