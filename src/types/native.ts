export type NativeLivenessState =
  | 'IDLE'
  | 'DETECTED'
  | 'CHALLENGE_ACTIVE'
  | 'LIVENESS_PASS'
  | 'LIVENESS_FAIL';

export type NativeLivenessChallenge =
  | 'NONE'
  | 'BLINK'
  | 'SMILE'
  | 'TURN_LEFT'
  | 'TURN_RIGHT';

export type NativeLivenessStateCode = 0 | 1 | 2 | 3 | 4;
export type NativeLivenessChallengeCode = 0 | 1 | 2 | 3 | 4;

export type NativeFaceAuthResult = {
  readonly accepted: boolean;
  readonly externalModelProcessed: boolean;
  readonly timestampNs: number;
  readonly sharpnessScore: number;
  readonly faceMeshProcessed: boolean;
  readonly mobileFaceNetProcessed: boolean;
  readonly droppedFrameCount: number;
  readonly replacedFrameCount: number;
  readonly faceMeshThreadCount: number;
  readonly mobileFaceNetThreadCount: number;
  readonly livenessState: NativeLivenessStateCode;
  readonly livenessChallenge: NativeLivenessChallengeCode;
  readonly faceDetected: boolean;
  readonly ear: number;
  readonly mar: number;
  readonly yaw: number;
  readonly pitch: number;
  readonly roll: number;
  readonly inferenceMs: number;
  readonly ramMb: number;
  readonly fftHighFrequencyRatio: number;
  readonly fftMoireScore: number;
  readonly passiveTextureOk: boolean;
  readonly passiveDepthOk: boolean;
  readonly passiveDepthRatio: number;
  readonly framesProcessed: number;
  readonly framesWithFace: number;
  readonly embeddingValid: boolean;
  readonly embeddingFrameId: number;
  readonly embedding: Float32Array;
  readonly embeddingPreview: number[];
  readonly embeddingLength: number;
  readonly embeddingByteLength: number;
};

export type NativeFaceAuthModule = {
  getLatestResult(): NativeFaceAuthResult;
  isInitialized(): boolean;
  setLivenessState(state: NativeLivenessStateCode): boolean;
  setLivenessChallenge(challenge: NativeLivenessChallengeCode): boolean;
  startEnrollmentBurst(): void;
  submitEnrollmentFrame(
    embedding: Float32Array,
    timestampNs?: number,
  ): { status: 'PENDING' | 'SUCCESS' | 'FAILED'; centroid: Float32Array | null };
  readonly frameProcessorRegistryReady: boolean;
};

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
  setLivenessState?: (state: NativeLivenessState) => Promise<void>;
  setLivenessChallenge?: (challenge: NativeLivenessChallenge) => Promise<void>;
  setLivenessPassed?: (passed: boolean) => Promise<void>;
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

export interface LSHModule {
  loadHyperplanes: (hyperplanes: number[][][]) => Promise<void>;
  computeBucketKeys: (embeddingBase64: string) => Promise<string[]>;
}
