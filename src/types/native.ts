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
}

export interface SecureEnclaveManagerModule {
  generateSecureRandomBase64: (byteLength: number) => Promise<string>;
  deriveDatabasePassphrase: (
    nonceBase64: string,
  ) => Promise<NativeDatabasePassphraseResult>;
}
